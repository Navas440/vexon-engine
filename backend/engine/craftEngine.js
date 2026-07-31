// ==========================================
// CRAFT ENGINE — VEXON (PARTE 1 DE 2)
// Banco, receitas, descoberta e lógica base de fabricação
// ==========================================

import db, { logWorldEvent, toJson, parseJson, getPlayer, insertItem, addItemToInventory } from "../db/database.js";
import { callOllamaWorld, getFullWorldState } from "../ia/worldEngine.js";
import { TOM_VEXON } from "../loreVexon.js";

// ==========================================
// TABELAS DO BANCO DE DADOS
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS receitas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT NOT NULL,
    descricao       TEXT,
    tipo_resultado  TEXT NOT NULL,  -- 'arma'|'armadura'|'consumivel'|'cibernetico'|'artefato'|'ferramenta'
    item_resultado  TEXT NOT NULL,  -- JSON com o item gerado
    
    -- Ingredientes (matéria-prima)
    ingredientes    TEXT NOT NULL,  -- JSON array: [{ nome, quantidade }]
    ferramenta      TEXT,           -- Ferramenta necessária (ex: "Forja", "Kit de Químico")
    
    -- Metadados de descoberta
    descoberta_por  INTEGER,        -- jogador_id que descobriu primeiro
    descoberta_em   DATETIME,
    vezes_craftada  INTEGER DEFAULT 0,
    
    -- Raridade do resultado
    raridade        TEXT DEFAULT 'comum',  -- 'comum'|'incomum'|'rara'|'muito_rara'|'lendaria'
    
    -- Contexto Vexon
    requer_local    TEXT,   -- Local específico onde pode ser fabricado (null = qualquer lugar)
    requer_nivel    INTEGER DEFAULT 1,  -- Nível mínimo do jogador
    
    criada_em       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS craft_historico (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id      INTEGER NOT NULL,
    receita_id      INTEGER,         -- null se foi descoberta nova
    ingredientes_usados TEXT NOT NULL,  -- JSON com os ingredientes que o jogador mandou
    ferramenta_usada TEXT,
    resultado       TEXT,           -- 'sucesso'|'falha'|'descoberta'|'explosao'|'item_corrompido'
    item_criado     TEXT,           -- JSON do item resultado (se sucesso)
    narrativa_ia    TEXT,           -- Narração da IA sobre o processo
    xp_ganho        INTEGER DEFAULT 0,
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS receitas_descobertas (
    jogador_id   INTEGER NOT NULL,
    receita_id   INTEGER NOT NULL,
    descoberta_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (jogador_id, receita_id),
    FOREIGN KEY (receita_id) REFERENCES receitas(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_receitas_tipo ON receitas(tipo_resultado);
  CREATE INDEX IF NOT EXISTS idx_receitas_raridade ON receitas(raridade);
  CREATE INDEX IF NOT EXISTS idx_craft_jogador ON craft_historico(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_receitas_descobertas ON receitas_descobertas(jogador_id);
`);

// ==========================================
// RECEITAS PREDEFINIDAS — COMPÊNDIO VEXON
// ==========================================

/**
 * Popula o banco com receitas base do universo Vexon.
 * Chamado uma vez na inicialização.
 */
export function inicializarReceitas() {
  const existentes = db.prepare("SELECT COUNT(*) as total FROM receitas").get().total;
  if (existentes > 0) return;

  const receitasBase = [
    // ── ARMAS ──────────────────────────────────────────────────────────────
    {
      nome: "Lâmina de Sombra",
      descricao: "Adaga forjada com metal sombrio e cristal de Quasiluz.",
      tipo_resultado: "arma",
      raridade: "incomum",
      ferramenta: "Forja",
      requer_nivel: 2,
      ingredientes: [
        { nome: "Metal Sombrio", quantidade: 2 },
        { nome: "Cristal de Quasiluz", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Lâmina de Sombra",
        tipo: "arma",
        raridade: "incomum",
        dano_ou_efeito: "1d6+2",
        propriedades: "finesse, leve",
        descricao: "Vibra levemente quando próxima de magia sintética.",
        habilidade_tematica: "Sombras",
        peso: "0.8 kg",
        valor: "180 po",
      },
    },
    {
      nome: "Bastão Arcano Improvisado",
      descricao: "Cano metálico canalizado com runa básica.",
      tipo_resultado: "arma",
      raridade: "comum",
      ferramenta: "Kit de Reparos",
      requer_nivel: 1,
      ingredientes: [
        { nome: "Cano de Metal", quantidade: 1 },
        { nome: "Runa Básica", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Bastão Arcano Improvisado",
        tipo: "arma",
        raridade: "comum",
        dano_ou_efeito: "1d4",
        propriedades: "arcano, frágil",
        descricao: "Conduz magia de forma instável. Pode falhar.",
        habilidade_tematica: "Arcano",
        peso: "1.2 kg",
        valor: "40 po",
      },
    },

    // ── ARMADURAS ───────────────────────────────────────────────────────────
    {
      nome: "Colete Reforçado com Fibra Neural",
      descricao: "Colete leve integrado com tecido de fibra neural cibernética.",
      tipo_resultado: "armadura",
      raridade: "incomum",
      ferramenta: "Kit de Costura Tática",
      requer_nivel: 2,
      ingredientes: [
        { nome: "Couro Reforçado", quantidade: 2 },
        { nome: "Fibra Neural", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Colete de Fibra Neural",
        tipo: "armadura",
        raridade: "incomum",
        dano_ou_efeito: null,
        propriedades: "CA +13, leve, resistência elétrica",
        descricao: "Absorve impulsos elétricos e se adapta ao movimento.",
        habilidade_tematica: "Cibernético",
        peso: "3 kg",
        valor: "250 po",
      },
    },

    // ── CONSUMÍVEIS ─────────────────────────────────────────────────────────
    {
      nome: "Poção de Adrenalina Sintética",
      descricao: "Coquetel químico que acelera reflexos por 1 rodada.",
      tipo_resultado: "consumivel",
      raridade: "incomum",
      ferramenta: "Kit de Químico",
      requer_nivel: 1,
      ingredientes: [
        { nome: "Extratos Bioquímicos", quantidade: 2 },
        { nome: "Frasco Esterilizado", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Poção de Adrenalina Sintética",
        tipo: "consumivel",
        raridade: "incomum",
        dano_ou_efeito: "vantagem em ataques por 1 turno",
        propriedades: "consumível, químico",
        descricao: "Sabor metálico. Coração acelera perigosamente.",
        habilidade_tematica: null,
        peso: "0.2 kg",
        valor: "75 po",
      },
    },
    {
      nome: "Bomba de Fumaça Tática",
      descricao: "Granada artesanal que cobre uma área de 4m com fumaça densa.",
      tipo_resultado: "consumivel",
      raridade: "comum",
      ferramenta: "Kit de Químico",
      requer_nivel: 1,
      ingredientes: [
        { nome: "Pó de Enxofre", quantidade: 3 },
        { nome: "Invólucro Metálico", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Bomba de Fumaça",
        tipo: "consumivel",
        raridade: "comum",
        dano_ou_efeito: "área 4m, desvantagem em ataques até fumaça dissipar",
        propriedades: "arremessável, consumível",
        descricao: "Fumaça tão densa que apaga a sombra.",
        habilidade_tematica: null,
        peso: "0.3 kg",
        valor: "25 po",
      },
    },
    {
      nome: "Toxina de Σ-Prime Diluída",
      descricao: "Amostra do vírus Σ-Prime diluída para uso não letal.",
      tipo_resultado: "consumivel",
      raridade: "rara",
      ferramenta: "Kit de Químico",
      requer_nivel: 4,
      requer_local: "Laboratório",
      ingredientes: [
        { nome: "Amostra Σ-Prime", quantidade: 1 },
        { nome: "Reagente Neutralizador", quantidade: 2 },
        { nome: "Frasco Criogênico", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Toxina Σ-Prime Diluída",
        tipo: "consumivel",
        raridade: "rara",
        dano_ou_efeito: "envenena por 3 turnos, CD 15 para resistir",
        propriedades: "venenoso, instável, consumível",
        descricao: "Uma dose pode mudar quem a recebe para sempre.",
        habilidade_tematica: "Bioenergético",
        peso: "0.1 kg",
        valor: "300 po",
      },
    },

    // ── CIBERNÉTICOS ────────────────────────────────────────────────────────
    {
      nome: "Implante Ocular de Visão Noturna",
      descricao: "Módulo ocular que permite enxergar no escuro total.",
      tipo_resultado: "cibernetico",
      raridade: "incomum",
      ferramenta: "Kit Cirúrgico",
      requer_nivel: 2,
      requer_local: "Clínica Clandestina",
      ingredientes: [
        { nome: "Chip Óptico", quantidade: 1 },
        { nome: "Fibra Neural", quantidade: 1 },
        { nome: "Gel Nanomédico", quantidade: 2 },
      ],
      item_resultado: {
        nome: "Implante Ocular Noturno",
        tipo: "acessorio",
        raridade: "incomum",
        dano_ou_efeito: "visão no escuro 18m",
        propriedades: "implante, passivo, cirúrgico",
        descricao: "Os olhos ficam levemente bioluminescentes na escuridão.",
        habilidade_tematica: "Cibernético",
        peso: "0 kg",
        valor: "320 po",
      },
    },
    {
      nome: "Reforço de Subdermal de Titânio",
      descricao: "Placas de titânio inseridas sob a pele para absorção de impacto.",
      tipo_resultado: "cibernetico",
      raridade: "rara",
      ferramenta: "Kit Cirúrgico",
      requer_nivel: 3,
      requer_local: "Clínica Clandestina",
      ingredientes: [
        { nome: "Placas de Titânio", quantidade: 3 },
        { nome: "Gel Nanomédico", quantidade: 3 },
        { nome: "Fibra Neural", quantidade: 2 },
      ],
      item_resultado: {
        nome: "Subdermal de Titânio",
        tipo: "acessorio",
        raridade: "rara",
        dano_ou_efeito: "CA +2 permanente, resistência a dano físico",
        propriedades: "implante, passivo, cirúrgico",
        descricao: "A pele endurece visivelmente. Cicatrizes lineares perfeitamente simétricas.",
        habilidade_tematica: "Cibernético",
        peso: "0 kg",
        valor: "600 po",
      },
    },

    // ── ARTEFATOS MÁGICOS ───────────────────────────────────────────────────
    {
      nome: "Sigilo da Ordem dos Sussurradores",
      descricao: "Símbolo arcano usado pelos Sussurradores para comunicação secreta.",
      tipo_resultado: "artefato",
      raridade: "rara",
      ferramenta: "Grimório de Umbros",
      requer_nivel: 3,
      requer_local: "Santuário Oculto",
      ingredientes: [
        { nome: "Prata Purificada", quantidade: 1 },
        { nome: "Sangue do Artesão", quantidade: 1 },
        { nome: "Tinta de Sombra", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Sigilo dos Sussurradores",
        tipo: "artefato",
        raridade: "rara",
        dano_ou_efeito: "permite comunicação telepática entre portadores",
        propriedades: "mágico, sintonizado, Sussurradores",
        descricao: "Pulsa suavemente quando outro portador está próximo.",
        habilidade_tematica: "Sombras",
        peso: "0.1 kg",
        valor: "500 po",
      },
    },
    {
      nome: "Runa de Contenção do Vácuo",
      descricao: "Runa atlante que repele influência do Vácuo temporariamente.",
      tipo_resultado: "artefato",
      raridade: "muito_rara",
      ferramenta: "Grimório de Umbros",
      requer_nivel: 5,
      requer_local: "Tir-Naleth",
      ingredientes: [
        { nome: "Pedra de Tir-Naleth", quantidade: 2 },
        { nome: "Sangue do Artesão", quantidade: 1 },
        { nome: "Essência do Vácuo", quantidade: 1 },
      ],
      item_resultado: {
        nome: "Runa de Contenção",
        tipo: "artefato",
        raridade: "muito_rara",
        dano_ou_efeito: "imunidade a efeitos do Vácuo por 1 hora",
        propriedades: "mágico, consumível único, atlante",
        descricao: "Gravada por mãos que não eram humanas.",
        habilidade_tematica: "Atlante",
        peso: "0.5 kg",
        valor: "1200 po",
      },
    },
  ];

  for (const receita of receitasBase) {
    db.prepare(`
      INSERT INTO receitas (
        nome, descricao, tipo_resultado, raridade, ferramenta,
        requer_nivel, requer_local, ingredientes, item_resultado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receita.nome,
      receita.descricao,
      receita.tipo_resultado,
      receita.raridade,
      receita.ferramenta ?? null,
      receita.requer_nivel ?? 1,
      receita.requer_local ?? null,
      toJson(receita.ingredientes),
      toJson(receita.item_resultado)
    );
  }

  console.log(`[CraftEngine] ${receitasBase.length} receitas base inicializadas.`);
}

// ==========================================
// CONSULTA DE RECEITAS
// ==========================================

/**
 * Retorna todas as receitas descobertas por um jogador.
 */
export function getReceitasDescobertas(jogador_id) {
  return db.prepare(`
    SELECT r.*, rd.descoberta_em
    FROM receitas r
    JOIN receitas_descobertas rd ON r.id = rd.receita_id
    WHERE rd.jogador_id = ?
    ORDER BY rd.descoberta_em DESC
  `).all(jogador_id).map(r => ({
    ...r,
    ingredientes: parseJson(r.ingredientes, []),
    item_resultado: parseJson(r.item_resultado, {}),
  }));
}

/**
 * Retorna uma receita por ID.
 */
export function getReceitaById(receita_id) {
  const r = db.prepare("SELECT * FROM receitas WHERE id = ?").get(receita_id);
  if (!r) return null;
  return {
    ...r,
    ingredientes: parseJson(r.ingredientes, []),
    item_resultado: parseJson(r.item_resultado, {}),
  };
}

/**
 * Marca uma receita como descoberta por um jogador.
 */
export function marcarReceitaDescoberta(jogador_id, receita_id) {
  db.prepare(`
    INSERT OR IGNORE INTO receitas_descobertas (jogador_id, receita_id)
    VALUES (?, ?)
  `).run(jogador_id, receita_id);

  db.prepare(`
    UPDATE receitas SET descoberta_por = ?, descoberta_em = CURRENT_TIMESTAMP
    WHERE id = ? AND descoberta_por IS NULL
  `).run(jogador_id, receita_id);
}

// ==========================================
// BUSCA POR INGREDIENTES (tentativa de craft)
// ==========================================

/**
 * Tenta encontrar uma receita conhecida que corresponda à combinação.
 * Retorna a receita se encontrada, null se é uma combinação desconhecida.
 *
 * @param {Array} ingredientes - [{ nome, quantidade }]
 * @param {string} ferramenta - Nome da ferramenta usada
 * @param {number} jogador_id
 */
export function buscarReceitaPorIngredientes(ingredientes, ferramenta, jogador_id) {
  // Normaliza os ingredientes recebidos
  const nomesRecebidos = ingredientes
    .map(i => i.nome.toLowerCase().trim())
    .sort();

  // Busca em todas as receitas (não só descobertas — a IA pode validar qualquer combinação)
  const todasReceitas = db.prepare("SELECT * FROM receitas").all();

  for (const receita of todasReceitas) {
    const ingredientesReceita = parseJson(receita.ingredientes, []);
    const nomesReceita = ingredientesReceita
      .map(i => i.nome.toLowerCase().trim())
      .sort();

    const ferramentaOk = !receita.ferramenta ||
      receita.ferramenta.toLowerCase() === (ferramenta || "").toLowerCase();

    const ingredientesOk = nomesRecebidos.length === nomesReceita.length &&
      nomesRecebidos.every((n, i) => n === nomesReceita[i]);

    if (ingredientesOk && ferramentaOk) {
      return {
        ...receita,
        ingredientes: ingredientesReceita,
        item_resultado: parseJson(receita.item_resultado, {}),
      };
    }
  }

  return null; // Combinação desconhecida → vai para a IA
}

// ==========================================
// HISTÓRICO DE CRAFT
// ==========================================

/**
 * Registra uma tentativa de craft no histórico.
 */
export function registrarCraft(jogador_id, receita_id, ingredientes_usados, ferramenta, resultado, item_criado, narrativa_ia, xp_ganho) {
  db.prepare(`
    INSERT INTO craft_historico (
      jogador_id, receita_id, ingredientes_usados, ferramenta_usada,
      resultado, item_criado, narrativa_ia, xp_ganho
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jogador_id,
    receita_id ?? null,
    toJson(ingredientes_usados),
    ferramenta ?? null,
    resultado,
    item_criado ? toJson(item_criado) : null,
    narrativa_ia ?? null,
    xp_ganho ?? 0
  );
}

/**
 * Retorna o histórico de craft de um jogador.
 */
export function getHistoricoCraft(jogador_id, limit = 20) {
  return db.prepare(`
    SELECT * FROM craft_historico
    WHERE jogador_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(jogador_id, limit).map(c => ({
    ...c,
    ingredientes_usados: parseJson(c.ingredientes_usados, []),
    item_criado: parseJson(c.item_criado, null),
  }));
}

// ==========================================
// VALIDAÇÕES BASE
// ==========================================

/**
 * Verifica se o jogador tem os ingredientes no inventário.
 */
export function validarIngredientesInventario(jogador_id, ingredientes) {
  const faltando = [];

  for (const ing of ingredientes) {
    const noInventario = db.prepare(`
      SELECT SUM(quantidade) as total
      FROM inventario i
      JOIN itens it ON i.item_id = it.id
      WHERE i.jogador_id = ? AND LOWER(it.nome) LIKE LOWER(?)
    `).get(jogador_id, `%${ing.nome}%`);

    if (!noInventario?.total || noInventario.total < ing.quantidade) {
      faltando.push({ nome: ing.nome, necessario: ing.quantidade, disponivel: noInventario?.total || 0 });
    }
  }

  return { ok: faltando.length === 0, faltando };
}

/**
 * Consome os ingredientes do inventário após craft bem-sucedido.
 */
export function consumirIngredientes(jogador_id, ingredientes) {
  for (const ing of ingredientes) {
    // Busca o item no inventário
    const itemInv = db.prepare(`
      SELECT i.id, i.quantidade
      FROM inventario i
      JOIN itens it ON i.item_id = it.id
      WHERE i.jogador_id = ? AND LOWER(it.nome) LIKE LOWER(?)
      LIMIT 1
    `).get(jogador_id, `%${ing.nome}%`);

    if (!itemInv) continue;

    const novaQtd = itemInv.quantidade - ing.quantidade;
    if (novaQtd <= 0) {
      db.prepare("DELETE FROM inventario WHERE id = ?").run(itemInv.id);
    } else {
      db.prepare("UPDATE inventario SET quantidade = ? WHERE id = ?").run(novaQtd, itemInv.id);
    }
  }
}
// ==========================================
// CRAFT ENGINE — VEXON (PARTE 2 DE 2)
// Sistema de descoberta via IA, fluxo de craft e rotas
// ==========================================


// ==========================================
// JULGAMENTO DA IA — SISTEMA DE DESCOBERTA
// ==========================================

/**
 * A IA recebe os ingredientes e a ferramenta usados pelo jogador
 * e decide o que sai da combinação — sucesso, falha, explosão, item corrompido.
 *
 * Este é o coração do sistema de descoberta.
 *
 * @param {Array}  ingredientes - [{ nome, quantidade }]
 * @param {string} ferramenta
 * @param {object} player
 * @returns {Promise<{ resultado, item_criado, narrativa, xp_ganho, tipo_resultado }>}
 */
async function julgarDescobertaIA(ingredientes, ferramenta, player) {
  const estado = getFullWorldState();

  const listaIngredientes = ingredientes
    .map(i => `${i.quantidade}x ${i.nome}`)
    .join(", ");

  const prompt = `${TOM_VEXON}

Você é o Mestre de Craft do RPG Vexon.

O jogador ${player.nome} (Nível ${player.nivel}) tentou criar algo combinando:
Ingredientes: ${listaIngredientes}
Ferramenta usada: ${ferramenta || "nenhuma"}

Estado do mundo:
- Quasiluz no ar: ${estado.nivel_quasiluz}% (alta contaminação pode corromper itens)
- Influência do Vácuo: ${estado.influencia_vacuo}% (pode distorcer magia)

Julgue o resultado com criatividade. Combinações que fazem sentido temático devem funcionar.
Combinações absurdas devem falhar de forma interessante.
Combinações perigosas podem explodir ou criar algo corrompido.

Responda SOMENTE com JSON válido:
{
  "resultado": "sucesso|falha|descoberta|explosao|item_corrompido",
  "tipo_resultado": "arma|armadura|consumivel|cibernetico|artefato|ferramenta|nenhum",
  "item_criado": {
    "nome": "Nome do item criado",
    "tipo": "arma|armadura|consumivel|ferramenta|acessorio|artefato|magico",
    "raridade": "comum|incomum|rara|muito_rara|lendaria",
    "dano_ou_efeito": "efeito mecânico ou null",
    "propriedades": "lista de propriedades",
    "descricao": "Descrição imersiva de 1 frase no universo Vexon",
    "habilidade_tematica": "Sombras|Cibernético|Arcano|Bioenergético|Atlante|null",
    "peso": "X kg",
    "valor": "X po"
  },
  "narrativa": "1-2 parágrafos descrevendo o processo de criação em segunda pessoa, tom sombrio Vexon",
  "xp_ganho": número entre 0 e 50,
  "dano_ao_jogador": número de HP de dano (0 se não houver, pode ser até 10 em explosões)
}

Se resultado for "falha", "explosao" ou "item_corrompido", item_criado pode ser null ou o item defeituoso.`;

  const raw = await callOllamaWorld([
    { role: "system", content: "Você é o Mestre de Craft. Responda APENAS com JSON válido." },
    { role: "user",   content: prompt },
  ], { num_predict: 500, temperature: 0.85 });

  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Nenhum JSON válido da IA.");

  return JSON.parse(match[0]);
}

/**
 * Fallback quando a IA falha — julga a combinação localmente
 * baseado em heurísticas simples.
 */
function julgarDescobertaFallback(ingredientes, ferramenta, player) {
  const nomes = ingredientes.map(i => i.nome.toLowerCase()).join(" ");

  // Heurísticas básicas por palavras-chave
  if (/explosivo|pólvora|acelerant|combustível/i.test(nomes)) {
    return {
      resultado: "explosao",
      tipo_resultado: "nenhum",
      item_criado: null,
      narrativa: "A mistura reage de forma violenta. Uma explosão pequena te joga para trás.",
      xp_ganho: 5,
      dano_ao_jogador: 4,
    };
  }

  if (/vácuo|corrompido|maldito|abissal/i.test(nomes)) {
    return {
      resultado: "item_corrompido",
      tipo_resultado: "artefato",
      item_criado: {
        nome: "Fragmento Corrompido",
        tipo: "artefato",
        raridade: "incomum",
        dano_ou_efeito: "aleatório — pode curar ou ferir",
        propriedades: "instável, corrompido",
        descricao: "Pulsa com energia que não deveria existir.",
        habilidade_tematica: "Sombras",
        peso: "0.3 kg",
        valor: "80 po",
      },
      narrativa: "O processo escapa ao controle. O item resultante é... imprevisível.",
      xp_ganho: 15,
      dano_ao_jogador: 0,
    };
  }

  if (/metal|ferro|titânio|aço/i.test(nomes) && ferramenta?.toLowerCase().includes("forja")) {
    return {
      resultado: "sucesso",
      tipo_resultado: "arma",
      item_criado: {
        nome: "Arma Forjada Improvisada",
        tipo: "arma",
        raridade: "comum",
        dano_ou_efeito: "1d6",
        propriedades: "resistente",
        descricao: "Trabalho bruto mas funcional.",
        habilidade_tematica: null,
        peso: "1.5 kg",
        valor: "50 po",
      },
      narrativa: "O metal cede ao calor da forja. O resultado não é bonito, mas funciona.",
      xp_ganho: 10,
      dano_ao_jogador: 0,
    };
  }

  // Falha genérica
  return {
    resultado: "falha",
    tipo_resultado: "nenhum",
    item_criado: null,
    narrativa: "Os materiais não reagem como esperado. A combinação não produz nada útil.",
    xp_ganho: 2,
    dano_ao_jogador: 0,
  };
}

// ==========================================
// FLUXO PRINCIPAL DE CRAFT
// ==========================================

/**
 * Processa uma tentativa de craft pelo jogador.
 *
 * Fluxo:
 * 1. Valida ingredientes no inventário
 * 2. Verifica se é uma receita conhecida
 * 3. Se desconhecida → manda para a IA julgar (descoberta)
 * 4. Consome ingredientes
 * 5. Cria o item no banco se sucesso
 * 6. Registra histórico
 *
 * @param {number} jogador_id
 * @param {Array}  ingredientes - [{ nome, quantidade }]
 * @param {string} ferramenta   - Nome da ferramenta usada
 * @param {string} local_atual  - Local onde está craftando
 */
export async function tentarCraft(jogador_id, ingredientes, ferramenta = null, local_atual = null) {
  if (!ingredientes || ingredientes.length === 0) {
    throw new Error("Nenhum ingrediente fornecido.");
  }

  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);

  // ── 1. Valida inventário ───────────────────────────────────────────────
  const validacao = validarIngredientesInventario(jogador_id, ingredientes);
  if (!validacao.ok) {
    const faltando = validacao.faltando
      .map(f => `${f.nome} (tem ${f.disponivel}, precisa ${f.necessario})`)
      .join(", ");
    throw new Error(`Ingredientes insuficientes: ${faltando}`);
  }

  // ── 2. Verifica receita conhecida ─────────────────────────────────────
  const receitaConhecida = buscarReceitaPorIngredientes(ingredientes, ferramenta, jogador_id);

  let julgamento;
  let receitaId = null;
  let foiDescoberta = false;

  if (receitaConhecida) {
    // Receita existe — valida nível e local
    if (player.nivel < (receitaConhecida.requer_nivel || 1)) {
      throw new Error(`Você precisa ser nível ${receitaConhecida.requer_nivel} para usar esta receita.`);
    }
    if (receitaConhecida.requer_local && local_atual?.toLowerCase() !== receitaConhecida.requer_local?.toLowerCase()) {
      throw new Error(`Esta receita requer: ${receitaConhecida.requer_local}.`);
    }

    receitaId = receitaConhecida.id;

    // Verifica se o jogador já conhecia a receita
    const jaConhecia = db.prepare(`
      SELECT 1 FROM receitas_descobertas
      WHERE jogador_id = ? AND receita_id = ?
    `).get(jogador_id, receitaId);

    if (!jaConhecia) {
      foiDescoberta = true;
      marcarReceitaDescoberta(jogador_id, receitaId);
    }

    julgamento = {
      resultado: "sucesso",
      tipo_resultado: receitaConhecida.tipo_resultado,
      item_criado: receitaConhecida.item_resultado,
      narrativa: `A combinação reage perfeitamente. ${receitaConhecida.nome} foi criado.`,
      xp_ganho: foiDescoberta ? 30 : 10,
      dano_ao_jogador: 0,
    };
  } else {
    // ── 3. Combinação desconhecida → IA julga ───────────────────────────
    try {
      julgamento = await julgarDescobertaIA(ingredientes, ferramenta, player);
      foiDescoberta = julgamento.resultado === "sucesso" || julgamento.resultado === "descoberta";
    } catch (err) {
      console.warn("[CraftEngine] IA falhou, usando fallback:", err.message);
      julgamento = julgarDescobertaFallback(ingredientes, ferramenta, player);
    }

    // Se IA criou item com sucesso, salva como nova receita descoberta
    if ((julgamento.resultado === "sucesso" || julgamento.resultado === "descoberta") && julgamento.item_criado) {
      const novaReceita = db.prepare(`
        INSERT INTO receitas (
          nome, descricao, tipo_resultado, ingredientes, ferramenta,
          item_resultado, descoberta_por, descoberta_em, raridade, requer_nivel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      `).run(
        julgamento.item_criado.nome,
        `Descoberta por ${player.nome}`,
        julgamento.tipo_resultado,
        toJson(ingredientes),
        ferramenta ?? null,
        toJson(julgamento.item_criado),
        jogador_id,
        julgamento.item_criado.raridade ?? "comum",
        player.nivel
      );

      receitaId = novaReceita.lastInsertRowid;
      marcarReceitaDescoberta(jogador_id, receitaId);
      foiDescoberta = true;

      console.log(`[CraftEngine] Nova receita descoberta: "${julgamento.item_criado.nome}" por ${player.nome}`);
    }
  }

  // ── 4. Consome ingredientes ────────────────────────────────────────────
  consumirIngredientes(jogador_id, ingredientes);

  // ── 5. Cria item no banco se sucesso ──────────────────────────────────
  let itemId = null;
  if (julgamento.item_criado && ["sucesso", "descoberta", "item_corrompido"].includes(julgamento.resultado)) {
    const itemResult = insertItem(julgamento.item_criado);
    itemId = itemResult.lastInsertRowid;
    addItemToInventory(jogador_id, itemId, 1);
  }

  // ── 6. Aplica dano ao jogador (explosão, etc) ─────────────────────────
  if (julgamento.dano_ao_jogador > 0) {
    const novoHp = Math.max(0, player.hp_atual - julgamento.dano_ao_jogador);
    db.prepare("UPDATE jogadores SET hp_atual = ? WHERE id = ?").run(novoHp, jogador_id);
  }

  // ── 7. Registra histórico ─────────────────────────────────────────────
  registrarCraft(
    jogador_id,
    receitaId,
    ingredientes,
    ferramenta,
    julgamento.resultado,
    julgamento.item_criado,
    julgamento.narrativa,
    julgamento.xp_ganho
  );

  // Atualiza contador de vezes craftada se receita existia
  if (receitaId) {
    db.prepare("UPDATE receitas SET vezes_craftada = vezes_craftada + 1 WHERE id = ?").run(receitaId);
  }

  return {
    resultado:      julgamento.resultado,
    item_criado:    julgamento.item_criado ?? null,
    item_id:        itemId,
    narrativa:      julgamento.narrativa,
    xp_ganho:       julgamento.xp_ganho,
    dano_sofrido:   julgamento.dano_ao_jogador ?? 0,
    foi_descoberta: foiDescoberta,
    receita_id:     receitaId,
    nova_receita:   foiDescoberta && !receitaConhecida,
    player: {
      hp_atual: Math.max(0, player.hp_atual - (julgamento.dano_ao_jogador ?? 0)),
    },
  };
}

// ==========================================
// ROTAS HTTP
// ==========================================

export function setupCraftRoutes(app) {
  // POST - Tentar craftar (rota principal)
  app.post("/api/craft", async (req, res) => {
    const { jogador_id, ingredientes, ferramenta, local_atual } = req.body;

    if (!jogador_id)                return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });
    if (!ingredientes?.length)      return res.status(400).json({ sucesso: false, erro: "Ingredientes obrigatórios." });

    try {
      const resultado = await tentarCraft(jogador_id, ingredientes, ferramenta, local_atual);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Receitas descobertas pelo jogador
  app.get("/api/craft/receitas/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const receitas = getReceitasDescobertas(jogador_id);
      res.json({ sucesso: true, receitas, total: receitas.length });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Histórico de craft do jogador
  app.get("/api/craft/historico/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    try {
      const historico = getHistoricoCraft(jogador_id, limit);
      res.json({ sucesso: true, historico });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Detalhes de uma receita
  app.get("/api/craft/receita/:receita_id", (req, res) => {
    const receita_id = Number(req.params.receita_id);
    try {
      const receita = getReceitaById(receita_id);
      if (!receita) return res.status(404).json({ sucesso: false, erro: "Receita não encontrada." });
      res.json({ sucesso: true, receita });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[CraftEngine] Rotas registradas: /api/craft/*");
}
