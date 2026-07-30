import "dotenv/config";
import express        from "express";
import cors           from "cors";
import { setupQuestRoutes, iniciarQuestTicker } from "./engine/questEngine.js";
import { verificarCompletacaoObjetivos } from "./engine/questEngine.js";
import { processPlayerAction }               from "./engine/gameEngine.js";
import { sendToLLM, askMaster, checkOllamaHealth } from "./llmClient.js";
import { handleEntityCreation, gerarMonstroRapido, gerarNpcRapido } from "./entityHandler.js";
import { spawnEntity, getWorldSnapshot, getPlayer,
         getAllPlayers, getRecentEvents, getActiveEnemies,
         getPlayerInventory, closeDatabase }  from "./db/database.js";

// ==========================================
// CONFIGURAÇÃO
// ==========================================

const app  = express();
const PORT = process.env.PORT || 3000;

// Rate limiting simples em memória (sem dependência externa)
const requestCounts = new Map();
function rateLimiter(max = 30, windowMs = 60_000) {
  return (req, res, next) => {
    const key   = req.ip;
    const agora = Date.now();
    const entry = requestCounts.get(key) ?? { count: 0, reset: agora + windowMs };

    if (agora > entry.reset) {
      entry.count = 0;
      entry.reset = agora + windowMs;
    }

    entry.count++;
    requestCounts.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ erro: "Muitas requisições. Aguarde um momento." });
    }
    next();
  };
}

// ==========================================
// MIDDLEWARES
// ==========================================

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "DELETE"],
}));
app.use(express.json({ limit: "1mb" }));

// Log de requisições
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Rate limit nas rotas de IA (mais pesadas)
const aiLimiter = rateLimiter(20, 60_000);

// ==========================================
// HELPER DE RESPOSTA
// ==========================================

function ok(res, data)         { res.json({ sucesso: true,  ...data }); }
function erro(res, msg, code = 500, extra = {}) {
  console.error(`[Erro ${code}] ${msg}`);
  res.status(code).json({ sucesso: false, erro: msg, ...extra });
}

// ==========================================
// ROTA 0 — STATUS E HEALTH CHECK
// ==========================================

app.get("/", (_req, res) => {
  ok(res, {
    sistema: "Vexon Engine",
    versao:  "2.0.0",
    status:  "online",
    uptime:  Math.floor(process.uptime()) + "s",
  });
});

app.get("/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  const status = ollama.online && ollama.modelo_disponivel ? "ok" : "degradado";

  res.status(status === "ok" ? 200 : 503).json({
    status,
    ollama: {
      online:            ollama.online,
      modelo:            ollama.modelo,
      modelo_disponivel: ollama.modelo_disponivel,
      modelos_instalados:ollama.modelos_instalados ?? [],
      erro:              ollama.erro ?? null,
    },
    db: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// ROTA 1 — GAMEPLAY (ação do jogador)
// ==========================================

/**
 * POST /api/action
 * Body: { jogador_id: number, action: string }
 * Processa qualquer ação do jogador: combate, diálogo, inventário, exploração...
 */
app.post("/api/action", aiLimiter, async (req, res) => {
  const { jogador_id, action } = req.body;
  if (!jogador_id) return erro(res, "jogador_id é obrigatório.", 400);
  if (!action?.trim()) return erro(res, "action não pode ser vazia.", 400);

  try {
    console.log(`[Action] Jogador ${jogador_id}: "${action}"`);
    const resultado = await processPlayerAction(jogador_id, action);
    const objetivosCompletos = verificarCompletacaoObjetivos(jogador_id, resultado);
    ok(res, { ...resultado, objetivos_completos: objetivosCompletos });
  } catch (e) {
    erro(res, e.message);
  }
});

// ==========================================
// ROTA 2 — COMPÊNDIO (criação via IA)
// ==========================================

/**
 * POST /api/create
 * Body: { message: string, jogador_id?: number, playerLevel?: number }
 * Envia uma mensagem livre ao Mestre. Se a resposta for uma tool-use,
 * a entidade é criada automaticamente no banco.
 */
app.post("/api/create", aiLimiter, async (req, res) => {
  const { message, jogador_id = null, playerLevel = 1 } = req.body;
  if (!message?.trim()) return erro(res, "message é obrigatória.", 400);

  try {
    const resultado = await sendToLLM(message, jogador_id, { player: { nivel: playerLevel } });

    ok(res, {
      narrativa:       resultado.narrativa,
      tool_executada:  resultado.tool_executada,
      entidade_criada: resultado.entidade_criada ?? null,
      sessao_id:       resultado.sessao_id ?? null,
    });
  } catch (e) {
    erro(res, e.message);
  }
});

// ==========================================
// ROTA 3 — CRIAÇÃO DIRETA DE ENTIDADE
// ==========================================

/**
 * POST /api/entity
 * Body: { tipo_entidade: "npc"|"monstro"|"item", playerLevel?: number, ...dados }
 * Cria uma entidade diretamente sem passar pela IA.
 */
app.post("/api/entity", async (req, res) => {
  const { playerLevel = 1, ...data } = req.body;

  if (!data.tipo_entidade) return erro(res, "tipo_entidade é obrigatório (npc|monstro|item).", 400);
  if (!data.nome)          return erro(res, "nome é obrigatório.", 400);

  try {
    const entidade = await handleEntityCreation(data, playerLevel, true);
    ok(res, { entidade, mensagem: `${data.tipo_entidade} "${entidade.nome}" criado com sucesso.` });
  } catch (e) {
    erro(res, e.message, 400);
  }
});

// ==========================================
// ROTA 4 — SPAWN RÁPIDO
// ==========================================

/**
 * POST /api/spawn
 * Body: { nome: string, tipo: "monstro"|"npc", nivel?: number, ameaca?: string }
 * Spawna uma entidade no mundo vivo rapidamente.
 */
app.post("/api/spawn", async (req, res) => {
  const { nome, tipo = "monstro", nivel = 1, ameaca = "media" } = req.body;
  if (!nome) return erro(res, "nome é obrigatório.", 400);

  try {
    let entidade;

    if (tipo === "monstro") {
      entidade = await gerarMonstroRapido(nome, nivel, ameaca, true);
    } else {
      entidade = await gerarNpcRapido(nome, "civil", "comum", true);
    }

    // Instancia no mundo vivo
    const ativoId = spawnEntity(entidade.nome, tipo);

    ok(res, {
      mensagem:    `${entidade.nome} apareceu no mundo!`,
      entidade,
      ativo_id:    ativoId,
    });
  } catch (e) {
    erro(res, e.message);
  }
});

// ==========================================
// ROTA 5 — ESTADO DO MUNDO (HUD)
// ==========================================

/**
 * GET /api/world/:jogador_id
 * Retorna snapshot completo do mundo para atualizar o HUD do React.
 */
app.get("/api/world/:jogador_id", (req, res) => {
  const jogador_id = Number(req.params.jogador_id);
  if (!jogador_id) return erro(res, "jogador_id inválido.", 400);

  try {
    const snap = getWorldSnapshot(jogador_id);
    if (!snap.player) return erro(res, "Jogador não encontrado.", 404);
    ok(res, snap);
  } catch (e) {
    erro(res, e.message);
  }
});

/**
 * GET /api/player/:id
 * Retorna dados do jogador isolados.
 */
app.get("/api/player/:id", (req, res) => {
  const player = getPlayer(Number(req.params.id));
  if (!player) return erro(res, "Jogador não encontrado.", 404);
  ok(res, { player });
});

/**
 * GET /api/players
 * Lista todos os jogadores (útil para tela de seleção de personagem).
 */
app.get("/api/players", (_req, res) => {
  ok(res, { players: getAllPlayers() });
});

/**
 * GET /api/inventory/:jogador_id
 */
app.get("/api/inventory/:jogador_id", (req, res) => {
  const inv = getPlayerInventory(Number(req.params.jogador_id));
  ok(res, { inventario: inv });
});

/**
 * GET /api/enemies
 * Lista todas as entidades ativas não mortas.
 */
app.get("/api/enemies", (_req, res) => {
  ok(res, { inimigos: getActiveEnemies() });
});

/**
 * GET /api/events?limit=20
 * Retorna os eventos recentes do mundo vivo.
 */
app.get("/api/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  ok(res, { eventos: getRecentEvents(limit) });
});

// ==========================================
// ROTA 6 — NARRAÇÃO PONTUAL
// ==========================================

/**
 * POST /api/narrate
 * Body: { prompt: string }
 * Gera uma narração avulsa sem ação de jogador (entrada numa área, evento climático, etc.)
 */
app.post("/api/narrate", aiLimiter, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) return erro(res, "prompt é obrigatório.", 400);

  try {
    const narrativa = await askMaster(prompt, { num_predict: 200, temperature: 0.88 });
    ok(res, { narrativa });
  } catch (e) {
    erro(res, e.message);
  }
});

// ==========================================
// MIDDLEWARE DE ERRO GLOBAL
// ==========================================

// Rota não encontrada
app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: `Rota "${req.path}" não existe.` });
});

// Erro não capturado
app.use((err, _req, res, _next) => {
  console.error("[Erro não capturado]", err);
  res.status(500).json({ sucesso: false, erro: "Erro interno do servidor." });
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================

async function iniciar() {
  console.log("\n" + "═".repeat(52));
  console.log("  VEXON ENGINE — INICIALIZANDO");
  console.log("═".repeat(52));

  setupQuestRoutes(app);
  iniciarQuestTicker();


  // Verifica Ollama antes de subir
  const saude = await checkOllamaHealth();
  if (!saude.online) {
    console.warn(`\n  ⚠  Ollama offline em ${process.env.OLLAMA_URL || "http://localhost:11434"}`);
    console.warn("     O servidor vai subir, mas a IA estará indisponível.");
    console.warn("     Execute: ollama serve\n");
  } else if (!saude.modelo_disponivel) {
    console.warn(`\n  ⚠  Modelo "${saude.modelo}" não encontrado no Ollama.`);
    console.warn(`     Modelos instalados: ${saude.modelos_instalados.join(", ") || "nenhum"}`);
    console.warn(`     Execute: ollama pull ${saude.modelo}\n`);
  } else {
    console.log(`\n  ✓  Ollama online — modelo "${saude.modelo}" disponível`);
  }

  app.listen(PORT, () => {
    console.log(`  ✓  Servidor rodando em http://localhost:${PORT}`);
    console.log(`  ✓  Health check: http://localhost:${PORT}/health`);
    console.log("\n" + "═".repeat(52) + "\n");
  });
}

// Fecha o banco corretamente ao encerrar o processo
process.on("SIGINT",  () => { closeDatabase(); process.exit(0); });
process.on("SIGTERM", () => { closeDatabase(); process.exit(0); });

iniciar();