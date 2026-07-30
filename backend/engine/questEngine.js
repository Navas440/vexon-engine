// ==========================================
// QUEST ENGINE — VEXON (PARTE 1 DE 2)
// Estrutura de dados, banco e gerenciamento de estado
// ==========================================

import db, { logWorldEvent, toJson, parseJson, getPlayer } from "../db/database.js";
import { callOllamaWorld, getFullWorldState } from "../ia/worldEngine.js";
// ==========================================
// TABELAS DO BANCO DE DADOS
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS quests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id          INTEGER NOT NULL,
    titulo              TEXT NOT NULL,
    descricao           TEXT,
    categoria           TEXT NOT NULL,  -- 'resgate'|'faccao'|'cosmico'|'urbano'|'dinamica'
    tipo_quest          TEXT,            -- subtipo específico (ex: 'resgate_criancas', 'sabotagem_transmissor')
    status              TEXT DEFAULT 'ativa',  -- 'ativa'|'completada'|'falhada'|'abandonada'|'pausada'
    
    -- Mecânicas
    objetivo_principal  TEXT,
    objetivo_secundario TEXT,
    recompensa_xp       INTEGER DEFAULT 0,
    recompensa_ouro     INTEGER DEFAULT 0,
    recompensa_items    TEXT DEFAULT '[]',   -- JSON array de item objects
    
    -- Deadlines dinâmicos
    criada_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    deadline_em         DATETIME,
    dias_restantes      INTEGER,
    
    -- Contexto do mundo
    impacto_mundo       TEXT DEFAULT '{}',  -- JSON com deltas de contadores globais ao completar
    reacao_faccoes      TEXT DEFAULT '{}',  -- JSON com reações de facções
    
    -- Rastreamento de progresso
    progresso           INTEGER DEFAULT 0,  -- 0-100%
    etapa_atual         TEXT,
    missoes_subordinadas TEXT DEFAULT '[]', -- JSON array de sub-quests (opcional)
    
    -- Contexto dinâmico
    gerante_evento_id   INTEGER,            -- ID do evento_mundo_vexon que gerou esta quest
    npc_envolvido_id    INTEGER,            -- NPC que deu a quest (se aplicável)
    local_principal     TEXT,
    
    atualizado_em       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quest_objetivos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quest_id    INTEGER NOT NULL,
    tipo        TEXT NOT NULL,  -- 'eliminar'|'coletar'|'chegar'|'conversar'|'investigar'|'destruir'
    descricao   TEXT,
    target      TEXT,           -- nome do inimigo, item, local, NPC
    quantidade  INTEGER DEFAULT 1,
    completo    INTEGER DEFAULT 0,
    criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS quest_historico (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quest_id    INTEGER NOT NULL,
    evento      TEXT NOT NULL,  -- 'criada'|'progredida'|'completada'|'falhada'|'atualizada'
    descricao   TEXT,
    progresso   INTEGER,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_quests_jogador ON quests(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
  CREATE INDEX IF NOT EXISTS idx_quests_categoria ON quests(categoria);
  CREATE INDEX IF NOT EXISTS idx_quests_deadline ON quests(deadline_em);
  CREATE INDEX IF NOT EXISTS idx_objetivos_quest ON quest_objetivos(quest_id);
`);

// ==========================================
// CONFIGURAÇÕES GLOBAIS
// ==========================================

// Deadlines padrão por categoria (em minutos de tempo real, convertidos para "dias in-game")
// 1 dia in-game = 10 minutos de tempo real (configurável)
const DIAS_INGAME_MINUTOS = Number(process.env.DIAS_INGAME_MINUTOS) || 10;

const DEADLINES_PADRAO = {
  resgate:   { dias: 3,  minutos: 3 * DIAS_INGAME_MINUTOS  },  // 3 dias: urgente
  faccao:    { dias: 7,  minutos: 7 * DIAS_INGAME_MINUTOS  },  // 7 dias: normal
  cosmico:   { dias: 14, minutos: 14 * DIAS_INGAME_MINUTOS },  // 14 dias: longas
  urbano:    { dias: 5,  minutos: 5 * DIAS_INGAME_MINUTOS  },  // 5 dias: curtas
  dinamica:  { dias: 10, minutos: 10 * DIAS_INGAME_MINUTOS },  // 10 dias: variável
};

// ==========================================
// CRIAÇÃO DE QUESTS
// ==========================================

/**
 * Cria uma nova quest no banco.
 * Retorna o ID da quest criada.
 */
export function criarQuest(jogador_id, dados) {
  const {
    titulo,
    descricao,
    categoria = "dinamica",
    tipo_quest = null,
    objetivo_principal,
    objetivo_secundario = null,
    recompensa_xp = 100,
    recompensa_ouro = 50,
    recompensa_items = [],
    dias_deadline = null,
    impacto_mundo = {},
    reacao_faccoes = {},
    etapa_atual = "iniciada",
    npc_envolvido_id = null,
    local_principal = "Vexon City",
    gerante_evento_id = null,
  } = dados;

  // Calcula deadline
  const diasConfig = DEADLINES_PADRAO[categoria] ?? DEADLINES_PADRAO.dinamica;
  const diasFinal = dias_deadline ?? diasConfig.dias;
  const minutosFinal = diasFinal * DIAS_INGAME_MINUTOS;
  const deadlineEm = new Date(Date.now() + minutosFinal * 60_000);

  const result = db.prepare(`
    INSERT INTO quests (
      jogador_id, titulo, descricao, categoria, tipo_quest,
      objetivo_principal, objetivo_secundario,
      recompensa_xp, recompensa_ouro, recompensa_items,
      deadline_em, dias_restantes,
      impacto_mundo, reacao_faccoes,
      etapa_atual, npc_envolvido_id, local_principal, gerante_evento_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jogador_id,
    titulo,
    descricao,
    categoria,
    tipo_quest,
    objetivo_principal,
    objetivo_secundario,
    recompensa_xp,
    recompensa_ouro,
    toJson(recompensa_items),
    deadlineEm.toISOString(),
    diasFinal,
    toJson(impacto_mundo),
    toJson(reacao_faccoes),
    etapa_atual,
    npc_envolvido_id,
    local_principal,
    gerante_evento_id
  );

  const questId = result.lastInsertRowid;

  // Log
  registrarHistoricoQuest(questId, "criada", `Quest "${titulo}" iniciada.`, 0);
  logWorldEvent("quest", `[${categoria}] ${titulo}`, [jogador_id]);

  return questId;
}

/**
 * Retorna todas as quests do jogador com um status específico.
 */
export function getQuestsByStatus(jogador_id, status = "ativa") {
  return db.prepare(`
    SELECT * FROM quests
    WHERE jogador_id = ? AND status = ?
    ORDER BY deadline_em ASC
  `).all(jogador_id, status);
}

/**
 * Retorna uma quest específica por ID.
 */
export function getQuestById(quest_id) {
  const quest = db.prepare("SELECT * FROM quests WHERE id = ?").get(quest_id);
  if (!quest) return null;

  // Hydrata campos JSON
  quest.recompensa_items = parseJson(quest.recompensa_items, []);
  quest.impacto_mundo = parseJson(quest.impacto_mundo, {});
  quest.reacao_faccoes = parseJson(quest.reacao_faccoes, {});
  quest.missoes_subordinadas = parseJson(quest.missoes_subordinadas, []);

  // Carrega objetivos associados
  quest.objetivos = db.prepare("SELECT * FROM quest_objetivos WHERE quest_id = ?").all(quest_id);

  return quest;
}

/**
 * Retorna todas as quests ativas do jogador.
 */
export function getQuestsAtivas(jogador_id) {
  const quests = getQuestsByStatus(jogador_id, "ativa");
  return quests.map(q => getQuestById(q.id)); // Hydrata dados JSON
}

/**
 * Retorna histórico completo de uma quest.
 */
export function getHistoricoQuest(quest_id, limit = 20) {
  return db.prepare(`
    SELECT * FROM quest_historico
    WHERE quest_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(quest_id, limit);
}

// ==========================================
// OBJETIVOS DE QUEST
// ==========================================

/**
 * Adiciona um objetivo a uma quest.
 */
export function adicionarObjetivo(quest_id, tipo, descricao, target, quantidade = 1) {
  const result = db.prepare(`
    INSERT INTO quest_objetivos (quest_id, tipo, descricao, target, quantidade)
    VALUES (?, ?, ?, ?, ?)
  `).run(quest_id, tipo, descricao, target, quantidade);

  return result.lastInsertRowid;
}

/**
 * Marca um objetivo como completo.
 */
export function completarObjetivo(objetivo_id) {
  db.prepare("UPDATE quest_objetivos SET completo = 1 WHERE id = ?").run(objetivo_id);

  // Verifica se todos os objetivos da quest foram completados
  const objetivo = db.prepare("SELECT quest_id FROM quest_objetivos WHERE id = ?").get(objetivo_id);
  if (!objetivo) return;

  const quest = getQuestById(objetivo.quest_id);
  const todesCompletos = quest.objetivos.every(o => o.completo || o.id === objetivo_id);

  if (todesCompletos) {
    atualizarProgressoQuest(quest.id, 100);
  }
}

/**
 * Retorna quantos objetivos estão completos em uma quest.
 */
export function getProgressoObjetivos(quest_id) {
  const quest = getQuestById(quest_id);
  if (!quest || quest.objetivos.length === 0) return { completos: 0, total: 0, percentual: 0 };

  const completos = quest.objetivos.filter(o => o.completo).length;
  const total = quest.objetivos.length;
  const percentual = Math.round((completos / total) * 100);

  return { completos, total, percentual };
}

// ==========================================
// PROGRESSO E STATUS
// ==========================================

/**
 * Atualiza o progresso de uma quest (0-100%).
 */
export function atualizarProgressoQuest(quest_id, percentual, etapa_atual = null) {
  const final = Math.max(0, Math.min(100, percentual));
  db.prepare(`
    UPDATE quests
    SET progresso = ?, atualizado_em = CURRENT_TIMESTAMP
    ${etapa_atual ? ", etapa_atual = ?" : ""}
    WHERE id = ?
  `).run(etapa_atual ? [final, etapa_atual, quest_id] : [final, quest_id]);

  registrarHistoricoQuest(quest_id, "progredida", `Progresso: ${final}%`, final);
}

/**
 * Completa uma quest com sucesso e aplica recompensas.
 * Retorna o resultado com recompensas.
 */
export function completarQuest(quest_id, jogador_id) {
  const quest = getQuestById(quest_id);
  if (!quest) throw new Error(`Quest ${quest_id} não encontrada.`);
  if (quest.status !== "ativa") throw new Error(`Quest não está ativa (status: ${quest.status}).`);

  // Atualiza status
  db.prepare(`
    UPDATE quests
    SET status = 'completada', progresso = 100, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(quest_id);

  registrarHistoricoQuest(quest_id, "completada", "Quest concluída com sucesso!", 100);

  // Log
  logWorldEvent(
    "quest_completada",
    `[${quest.categoria}] ${quest.titulo} — completada por jogador ${jogador_id}`,
    [jogador_id]
  );

  // CORREÇÃO: Aplicar o impacto no mundo de verdade
  if (quest.impacto_mundo) {
    for (const [chave, delta] of Object.entries(quest.impacto_mundo)) {
      deltaWorldState(chave, delta);
    }
  }

  // RESTAURADO: O retorno é essencial para a API conseguir responder!
  return {
    quest_id,
    titulo: quest.titulo,
    recompensas: {
      xp: quest.recompensa_xp,
      ouro: quest.recompensa_ouro,
      items: quest.recompensa_items,
    },
    impacto_mundo: quest.impacto_mundo,
    reacao_faccoes: quest.reacao_faccoes,
  };
}

/**
 * Falha uma quest (tempo esgotado, objetivo impossível, etc).
 */
export function falharQuest(quest_id, motivo = "Falha desconhecida") {
  const quest = getQuestById(quest_id);
  if (!quest) throw new Error(`Quest ${quest_id} não encontrada.`);

  db.prepare(`
    UPDATE quests
    SET status = 'falhada', atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(quest_id);

  registrarHistoricoQuest(quest_id, "falhada", motivo, quest.progresso);

  logWorldEvent(
    "quest_falhada",
    `[${quest.categoria}] ${quest.titulo} — falhou: ${motivo}`,
    []
  );
}

/**
 * Abandona uma quest manualmente.
 */
export function abandonarQuest(quest_id) {
  db.prepare(`
    UPDATE quests
    SET status = 'abandonada', atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(quest_id);

  registrarHistoricoQuest(quest_id, "abandonada", "Quest abandonada pelo jogador.", null);
}

// ==========================================
// HISTÓRICO
// ==========================================

/**
 * Registra um evento no histórico de uma quest.
 */
export function registrarHistoricoQuest(quest_id, evento, descricao, progresso = null) {
  db.prepare(`
    INSERT INTO quest_historico (quest_id, evento, descricao, progresso)
    VALUES (?, ?, ?, ?)
  `).run(quest_id, evento, descricao, progresso);
}

// ==========================================
// VERIFICAÇÃO DE DEADLINES
// ==========================================

/**
 * Verifica e processa quests cujo deadline expirou.
 * Chamado periodicamente pelo servidor.
 *
 * @returns {array} Lista de quests que falharam por timeout
 */
export function verificarDeadlines() {
  const agora = new Date();
  const quests = db.prepare(`
    SELECT id, jogador_id, titulo FROM quests
    WHERE status = 'ativa' AND deadline_em < ?
  `).all(agora.toISOString());

  const falhadas = [];
  for (const quest of quests) {
    falharQuest(quest.id, "Deadline expirou");
    falhadas.push(quest);
  }

  return falhadas;
}

/**
 * Calcula dias restantes para uma quest.
 */
export function getDiasRestantes(quest_id) {
  const quest = db.prepare("SELECT deadline_em FROM quests WHERE id = ?").get(quest_id);
  if (!quest || !quest.deadline_em) return null;

  const agora = new Date();
  const deadline = new Date(quest.deadline_em);
  const msDiff = deadline - agora;
  const dias = Math.max(0, Math.ceil(msDiff / (DIAS_INGAME_MINUTOS * 60_000)));

  return dias;
}

// ==========================================
// BUSCA E FILTRO
// ==========================================

/**
 * Retorna quests filtradas por múltiplos critérios.
 */
export function buscarQuests(jogador_id, opcoes = {}) {
  const {
    status = null,
    categoria = null,
    tipo_quest = null,
    ordenarPor = "deadline_em",
    limite = 50,
  } = opcoes;

  let query = "SELECT * FROM quests WHERE jogador_id = ?";
  const params = [jogador_id];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  if (categoria) {
    query += " AND categoria = ?";
    params.push(categoria);
  }
  if (tipo_quest) {
    query += " AND tipo_quest = ?";
    params.push(tipo_quest);
  }

  query += ` ORDER BY ${ordenarPor} ASC LIMIT ?`;
  params.push(limite);

  return db.prepare(query).all(...params).map(q => getQuestById(q.id));
}

/**
 * Retorna estatísticas de quests do jogador.
 */
export function getEstatisticasQuests(jogador_id) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ativa' THEN 1 ELSE 0 END) as ativas,
      SUM(CASE WHEN status = 'completada' THEN 1 ELSE 0 END) as completadas,
      SUM(CASE WHEN status = 'falhada' THEN 1 ELSE 0 END) as falhadas,
      SUM(CASE WHEN status = 'abandonada' THEN 1 ELSE 0 END) as abandonadas,
      SUM(recompensa_xp) as xp_total,
      SUM(recompensa_ouro) as ouro_total
    FROM quests
    WHERE jogador_id = ?
  `).get(jogador_id);

  return {
    total: stats.total,
    ativas: stats.ativas,
    completadas: stats.completadas,
    falhadas: stats.falhadas,
    abandonadas: stats.abandonadas,
    recompensas_totais: {
      xp: stats.xp_total || 0,
      ouro: stats.ouro_total || 0,
    },
  };
}

// ==========================================
// TEMPLATES DE QUESTS PREDEFINIDAS (base para IA gerar)
// ==========================================

export const TEMPLATE_QUESTS_VEXON = {
  resgate_criancas: {
    categoria: "resgate",
    tipo_quest: "resgate_criancas",
    dias_deadline: 3,
    titulo_template: "Resgate de Crianças Desaparecidas",
    descricao_template: (ctx) =>
      `Crianças desapareceram do Orfanato São Elias. Informações apontam para um laboratório ` +
      `clandestino em ${ctx.local || "Nova Varnhold"}. Resgate-as antes que o Projeto Genesis as ` +
      `transforme em algo mais que humano.`,
    recompensa_xp: 200,
    recompensa_ouro: 150,
    impacto_mundo: { criancas_desaparecidas: -2, poder_darvoss: -3 },
    reacao_faccoes: { poder_resistencia: +5, poder_darvoss: -5 },
  },

  sabotagem_transmissor: {
    categoria: "urbano",
    tipo_quest: "sabotagem_transmissor",
    dias_deadline: 5,
    titulo_template: "Destrua a Torre de Quasiluz",
    descricao_template: (ctx) =>
      `Torre de transmissão da Darvoss Dynamics está contaminando a mente dos cidadãos de ` +
      `${ctx.local || "Vexon City"} com Quasiluz. Destrua-a e liberte as mentes.`,
    recompensa_xp: 150,
    recompensa_ouro: 100,
    impacto_mundo: { nivel_quasiluz: -10 },
    reacao_faccoes: { poder_resistencia: +3, poder_darvoss: -5 },
  },

  investigacao_irmandade: {
    categoria: "faccao",
    tipo_quest: "investigacao_irmandade",
    dias_deadline: 7,
    titulo_template: "Investigue o Ritual da Irmandade",
    descricao_template: (ctx) =>
      `Sinais de magia sintética foram detectados em ${ctx.local || "Bairro das Lanternas Azuis"}. ` +
      `A Irmandade Varkos está planejando algo. Descubra o quê antes que seja tarde demais.`,
    recompensa_xp: 180,
    recompensa_ouro: 120,
    impacto_mundo: { poder_irmandade: -2, rachadura_selo: -3 },
    reacao_faccoes: { poder_resistencia: +4 },
  },

  combate_khal_reth: {
    categoria: "cosmico",
    tipo_quest: "combate_khal_reth",
    dias_deadline: 14,
    titulo_template: "Confronte o Caçador Alienígena",
    descricao_template: (_ctx) =>
      `Khal-Reth, o caçador mercenário extraterrestre, está cada vez mais perto. ` +
      `Você precisa lidar com essa ameaça antes que ele se torne inpaável. ` +
      `Este será um combate épico.`,
    recompensa_xp: 300,
    recompensa_ouro: 250,
    impacto_mundo: { khal_reth_distancia: +30 },
  },

  selar_vacuo: {
    categoria: "cosmico",
    tipo_quest: "selar_vacuo",
    dias_deadline: 14,
    titulo_template: "Confronte a Influência do Vácuo",
    descricao_template: (ctx) =>
      `A entidade Irra'du-Namtar está corrompendo a linguagem e a sanidade em ${ctx.local || "Tir-Naleth"}. ` +
      `Viaje até as ruínas pré-humanas e selure a brecha do Vácuo antes que se torne irreversível.`,
    recompensa_xp: 280,
    recompensa_ouro: 200,
    impacto_mundo: { influencia_vacuo: -15 },
  },
};

// ==========================================
// GERADOR DE QUESTS DINÂMICAS
// ==========================================

/**
 * Gera uma quest completamente nova via IA baseada no estado do mundo.
 * A IA cria título, descrição, objetivos e recompensas coerentes com Vexon.
 *
 * @param {number} jogador_id
 * @param {string} categoria - 'resgate'|'faccao'|'cosmico'|'urbano'|'dinamica'
 * @param {number} player_level - Nível do jogador (afeta dificuldade)
 * @returns {Promise<{quest_id, titulo, descricao, ...}>}
 */
export async function gerarQuestDinamica(jogador_id, categoria = "dinamica", player_level = 1) {
  const estado = getFullWorldState();
  const player = getPlayer(jogador_id);

  const contextoCategoria = {
    resgate: `Crianças estão desaparecendo no Projeto Genesis da Darvoss Dynamics. ` +
             `Atualmente ${estado.criancas_desaparecidas} confirmadas.`,
    faccao: `Irmandade Varkos está a ${estado.poder_irmandade}% de poder. ` +
            `Darvoss Dynamics a ${estado.poder_darvoss}%. ` +
            `A Resistência precisa de heróis.`,
    cosmico: `Grande Selo ${estado.rachadura_selo}% rachado. Vácuo ${estado.influencia_vacuo}% ativo. ` +
             `Khal-Reth a ${estado.khal_reth_distancia}% de distância.`,
    urbano: `Becos de Vexon City e Nova Varnhold fervilham de intriga. ` +
            `Quasiluz contamina ${estado.nivel_quasiluz}% da população.`,
    dinamica: `Estado do mundo é crítico em múltiplos fronts. ` +
              `Gere uma quest que faça sentido com o caos atual.`,
  };

  const prompt = `Você é o criador de quests para o RPG Vexon.
Gere UMA quest única, dinâmica e coerente com o estado do mundo.

Contexto:
- Jogador: ${player?.nome} (Nível ${player_level})
- Categoria desejada: ${categoria}
- ${contextoCategoria[categoria]}
- Mundo: Grande Selo ${estado.rachadura_selo}% | Quasiluz ${estado.nivel_quasiluz}% | Irmandade ${estado.poder_irmandade}%

Gere SOMENTE um JSON válido, sem texto antes ou depois:
{
  "titulo": "Nome épico da quest",
  "descricao": "2-3 frases descrevendo a quest em segunda pessoa",
  "tipo_quest": "uma chave única (ex: investigacao_secreta, sabotagem_drone)",
  "objetivo_principal": "Objetivo 1 em texto",
  "objetivo_secundario": "Objetivo 2 opcional ou null",
  "objetivos": [
    { "tipo": "eliminar|coletar|chegar|conversar|investigar|destruir", "descricao": "Ação específica", "target": "Alvo (NPC, item, local)", "quantidade": 1 }
  ],
  "dias_deadline": número entre 1 e 14,
  "recompensa_xp": número entre 50 e 500,
  "recompensa_ouro": número entre 25 e 300,
  "local_principal": "Local de Vexon onde ocorre",
  "reacao_faccoes": { "poder_irmandade": -3, "poder_resistencia": +2 },
  "impacto_mundo": { "nivel_quasiluz": -5 }
}`;

  try {
    const raw = await callOllamaWorld([
      { role: "system", content: "Você é o criador de quests. Responda APENAS com JSON válido." },
      { role: "user", content: prompt },
    ], { num_predict: 400, temperature: 0.85 });

    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Nenhum JSON válido encontrado.");

    const questData = JSON.parse(match[0]);

    // Cria a quest
    const questId = criarQuest(jogador_id, {
      titulo: questData.titulo,
      descricao: questData.descricao,
      categoria,
      tipo_quest: questData.tipo_quest,
      objetivo_principal: questData.objetivo_principal,
      objetivo_secundario: questData.objetivo_secundario,
      recompensa_xp: Math.min(500, Math.max(50, questData.recompensa_xp)),
      recompensa_ouro: Math.min(300, Math.max(25, questData.recompensa_ouro)),
      dias_deadline: Math.min(14, Math.max(1, questData.dias_deadline)),
      reacao_faccoes: questData.reacao_faccoes || {},
      impacto_mundo: questData.impacto_mundo || {},
      local_principal: questData.local_principal || "Vexon City",
    });

    // Adiciona objetivos
    for (const obj of (questData.objetivos || [])) {
      adicionarObjetivo(questId, obj.tipo, obj.descricao, obj.target, obj.quantidade);
    }

    registrarHistoricoQuest(questId, "criada", `Quest dinâmica gerada pela IA em categoria ${categoria}`, 0);

    return {
      quest_id: questId,
      titulo: questData.titulo,
      descricao: questData.descricao,
      categoria,
      tipo_quest: questData.tipo_quest,
      recompensa_xp: questData.recompensa_xp,
      recompensa_ouro: questData.recompensa_ouro,
      dias_deadline: questData.dias_deadline,
    };
  } catch (err) {
    console.error("[QuestEngine] Geração dinâmica falhou:", err.message);
    // Fallback: usa uma quest de template aleatória
    return gerarQuestTemplate(jogador_id, categoria, player_level);
  }
}

// ==========================================
// GERADOR DE QUESTS POR TEMPLATE
// ==========================================

/**
 * Gera uma quest baseada em um template predefinido.
 * Mais rápido que IA, determinístico.
 */
export function gerarQuestTemplate(jogador_id, categoria = "urbano", player_level = 1) {
  const templateKey = Object.keys(TEMPLATE_QUESTS_VEXON).find(k =>
    TEMPLATE_QUESTS_VEXON[k].categoria === categoria
  ) || Object.keys(TEMPLATE_QUESTS_VEXON)[0];

  const template = TEMPLATE_QUESTS_VEXON[templateKey];
  const contexto = { local: "Vexon City" }; // pode ser customizado

  const questId = criarQuest(jogador_id, {
    titulo: template.titulo_template,
    descricao: template.descricao_template(contexto),
    categoria: template.categoria,
    tipo_quest: template.tipo_quest,
    objetivo_principal: `Cumpra os objetivos da quest "${template.titulo_template}"`,
    recompensa_xp: template.recompensa_xp * (1 + (player_level - 1) * 0.1),
    recompensa_ouro: template.recompensa_ouro * (1 + (player_level - 1) * 0.1),
    dias_deadline: template.dias_deadline,
    impacto_mundo: template.impacto_mundo,
    reacao_faccoes: template.reacao_faccoes,
    local_principal: contexto.local,
  });

  // Adiciona objetivos básicos
  adicionarObjetivo(questId, "investigar", template.descricao_template(contexto), contexto.local, 1);

  return {
    quest_id: questId,
    titulo: template.titulo_template,
    descricao: template.descricao_template(contexto),
    categoria: template.categoria,
    tipo_quest: template.tipo_quest,
    recompensa_xp: template.recompensa_xp,
    recompensa_ouro: template.recompensa_ouro,
    dias_deadline: template.dias_deadline,
  };
}

// ==========================================
// DETECÇÃO AUTOMÁTICA DE QUESTS
// ==========================================

/**
 * Analisa eventos do mundo e gera quests automaticamente.
 * Chamado pelo worldEngine quando eventos críticos ocorrem.
 *
 * @param {object} evento - Evento do mundo que pode gerar quest
 * @param {number} jogador_id - ID do jogador (se null, cria "global")
 */
export async function gerarQuestDeEvento(evento, jogador_id = null) {
  if (!evento) return null;

  const { categoria: catEvento, titulo, descricao, gerante_evento_id } = evento;

  // Mapeamento evento → categoria quest
  const mapa = {
    "cosmico": "cosmico",
    "faccao": "faccao",
    "urbano": "urbano",
    "dialogo": "urbano",
    "criacao": "urbano",
  };

  const catQuest = mapa[catEvento] || "dinamica";

  if (!jogador_id) {
    // Cria uma "quest global" que todos os jogadores veriam (opcional)
    console.log(`[QuestEngine] Evento "${titulo}" geraria quest global (não implementado).`);
    return null;
  }

  try {
    // Tenta gerar quest dinâmica baseada no evento
    const player = getPlayer(jogador_id);
    const questResult = await gerarQuestDinamica(jogador_id, catQuest, player?.nivel || 1);

    // Associa ao evento que a gerou
    db.prepare(`
      UPDATE quests SET gerante_evento_id = ?
      WHERE id = ?
    `).run(gerante_evento_id, questResult.quest_id);

    logWorldEvent("quest_gerada_evento", `Quest gerada de evento: "${titulo}"`, [jogador_id]);

    return questResult;
  } catch (err) {
    console.error("[QuestEngine] Falha ao gerar quest de evento:", err.message);
    // Fallback para template
    return gerarQuestTemplate(jogador_id, catQuest);
  }
}

// ==========================================
// PROCESSAMENTO PERIÓDICO
// ==========================================

/**
 * Processa quests no servidor:
 * 1. Verifica deadlines expirados
 * 2. Atualiza progresso baseado em ações do jogador
 * 3. Completa quests automáticas se objetivos foram atingidos
 *
 * Chamado a cada 1 minuto (30s em dev).
 */
export function processarQuestsTick() {
  try {
    // Verifica deadlines
    const falhadas = verificarDeadlines();
    if (falhadas.length > 0) {
      console.log(`[QuestEngine] ${falhadas.length} quests falhadas por deadline.`);
    }

    // Aqui você pode adicionar lógica adicional de processamento periódico
  } catch (err) {
    console.error("[QuestEngine] Erro no tick de quests:", err.message);
  }
}

// ==========================================
// INTEGRAÇÃO COM AÇÕES DO JOGADOR
// ==========================================

/**
 * Verifica se uma ação do jogador completa algum objetivo de quest.
 * Chamada após processPlayerAction.
 *
 * @param {number} jogador_id
 * @param {object} resultado - Resultado da ação (contém dados_mecanicos, etc)
 * @returns {array} Lista de objetivos completados
 */
export function verificarCompletacaoObjetivos(jogador_id, resultado) {
  const quests = getQuestsAtivas(jogador_id);
  const objetivosCom = [];

  for (const quest of quests) {
    if (!quest.objetivos) continue;

    for (const obj of quest.objetivos) {
      if (obj.completo) continue;

      let foiCompletado = false;

      // Verifica tipo de objetivo
      switch (obj.tipo) {
        case "eliminar":
          if (resultado?.dados_mecanicos?.ataque_jogador?.alvo?.morreu) {
            const nomeAlvo = resultado.dados_mecanicos.ataque_jogador.alvo.nome;
            if (nomeAlvo.toLowerCase().includes(obj.target.toLowerCase())) {
              foiCompletado = true;
            }
          }
          break;

        case "coletar":
          if (resultado?.item_obtido?.nome?.toLowerCase().includes(obj.target.toLowerCase())) {
            foiCompletado = true;
          }
          break;

        case "chegar":
          if (resultado?.localizacao?.toLowerCase().includes(obj.target.toLowerCase())) {
            foiCompletado = true;
          }
          break;

        case "conversar":
          if (resultado?.dialogo?.com?.toLowerCase().includes(obj.target.toLowerCase())) {
            foiCompletado = true;
          }
          break;

        case "investigar":
          if (resultado?.descoberta?.local?.toLowerCase().includes(obj.target.toLowerCase())) {
            foiCompletado = true;
          }
          break;

        case "destruir":
          if (resultado?.destruido?.nome?.toLowerCase().includes(obj.target.toLowerCase())) {
            foiCompletado = true;
          }
          break;
      }

      if (foiCompletado) {
        db.prepare("UPDATE quest_objetivos SET completo = 1 WHERE id = ?").run(obj.id);
        objetivosCom.push({
          quest_id: quest.id,
          objetivo_id: obj.id,
          quest_titulo: quest.titulo,
          objetivo_descricao: obj.descricao,
        });

        const todosCompletos = quest.objetivos.every(o => o.completo || o.id === obj.id);
        if (todosCompletos) {
          // Apenas chamamos a função centralizada. Ela cuida do histórico, do mundo e das recompensas!
          completarQuest(quest.id, jogador_id);
          console.log(`[QuestEngine] Quest "${quest.titulo}" completada automaticamente!`);
        }
      }
    }
  }
  
  // RESTAURADO: Faltava retornar a lista de objetivos no final da função
  return objetivosCom;
}
// ==========================================
// ROTAS HTTP PARA O SERVIDOR
// ==========================================

/**
 * Registra as rotas de quests no Express.
 * Chame em server.js: setupQuestRoutes(app)
 */
export function setupQuestRoutes(app) {
  // GET - Listar quests ativas do jogador
  app.get("/api/quest/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const quests = getQuestsAtivas(jogador_id);
      const stats = getEstatisticasQuests(jogador_id);
      res.json({ sucesso: true, quests, estatisticas: stats });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Detalhes de uma quest específica
  app.get("/api/quest/details/:quest_id", (req, res) => {
    const quest_id = Number(req.params.quest_id);
    try {
      const quest = getQuestById(quest_id);
      if (!quest) return res.status(404).json({ sucesso: false, erro: "Quest não encontrada." });

      const diasRestantes = getDiasRestantes(quest_id);
      const historico = db.prepare(`
        SELECT * FROM quest_historico WHERE quest_id = ? ORDER BY timestamp DESC LIMIT 10
      `).all(quest_id);

      res.json({ sucesso: true, quest, dias_restantes: diasRestantes, historico });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Gerar nova quest dinâmica
  app.post("/api/quest/gerar", async (req, res) => {
    const { jogador_id, categoria = "dinamica" } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });

    try {
      const player = getPlayer(jogador_id);
      const novaQuest = await gerarQuestDinamica(jogador_id, categoria, player?.nivel || 1);
      res.json({ sucesso: true, quest: novaQuest });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  
  // POST - Completar uma quest manualmente
  app.post("/api/quest/completar/:quest_id", (req, res) => {
    const quest_id = Number(req.params.quest_id);
    const { jogador_id } = req.body;

    try {
      // CORREÇÃO: Usar a função centralizada
      const resultado = completarQuest(quest_id, jogador_id);
      res.json({ sucesso: true, mensagem: `Quest "${resultado.titulo}" concluída!`, recompensas: resultado.recompensas });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Abandonar uma quest
  app.post("/api/quest/abandonar/:quest_id", (req, res) => {
    const quest_id = Number(req.params.quest_id);

    try {
      db.prepare(`
        UPDATE quests
        SET status = 'abandonada', atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(quest_id);

      registrarHistoricoQuest(quest_id, "abandonada", "Abandonada pelo jogador", null);

      res.json({ sucesso: true, mensagem: "Quest abandonada." });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Buscar quests com filtros
  app.get("/api/quest/buscar/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    const { status, categoria, tipo_quest } = req.query;

    try {
      const quests = buscarQuests(jogador_id, { status, categoria, tipo_quest });
      res.json({ sucesso: true, quests });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[QuestEngine] Rotas registradas: /api/quest/*");
}

// ==========================================
// TICKER PERIÓDICO
// ==========================================

let _questTicker = null;

/**
 * Inicia o processamento periódico de quests.
 */
export function iniciarQuestTicker() {
  if (_questTicker) return;

  const intervalo = (Number(process.env.QUEST_TICK_SEGUNDOS) || 60) * 1000;

  console.log(`[QuestEngine] Quest ticker iniciado — intervalo: ${intervalo / 1000}s`);

  _questTicker = setInterval(() => {
    try {
      processarQuestsTick();
    } catch (err) {
      console.error("[QuestEngine] Erro no ticker:", err.message);
    }
  }, intervalo);
}

/**
 * Para o processamento periódico.
 */
export function pararQuestTicker() {
  if (_questTicker) {
    clearInterval(_questTicker);
    _questTicker = null;
    console.log("[QuestEngine] Quest ticker parado.");
  }
}