// ==========================================
// FACTION ENGINE — VEXON (PARTE 1 DE 2)
// Estrutura de dados, banco, reputação e alianças
// ==========================================

// ==========================================
// IMPORTAÇÕES
// ==========================================

import db, { logWorldEvent, toJson, parseJson, getPlayer } from "../db/database.js";

import { deltaWorldState, getFullWorldState, callOllamaWorld } from "../ia/worldEngine.js";
import { TOM_VEXON } from "../loreVexon.js";
// ==========================================
// TABELAS DO BANCO DE DADOS
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS faccoes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                TEXT NOT NULL UNIQUE,
    descricao           TEXT,
    tipo                TEXT NOT NULL,  -- 'irmandade'|'corporacao'|'resistencia'|'criminal'|'cult'|'mercado'|'outro'
    poder               INTEGER DEFAULT 50,  -- 0-100 (força operacional global)
    moralidade          TEXT DEFAULT 'neutro',  -- 'bom'|'neutro'|'maligno'
    
    -- Liderança
    lider_npc_id        INTEGER,  -- NPC que lidera (pode mudar dinamicamente)
    lider_nome          TEXT,     -- Nome fallback se NPC for eliminado
    
    -- Recursos
    ouro_tesouro        INTEGER DEFAULT 1000,
    recrutados          INTEGER DEFAULT 0,  -- Número de membros ativos
    territorio          TEXT,     -- Local principal (JSON array de locais)
    
    -- Objetivos e alinhamento
    objetivo_principal  TEXT,
    objetivo_secundario TEXT,
    alinhamento_vexon   TEXT,  -- 'caotica'|'neutra'|'leal' (relação com Vexon City)
    
    -- Dinâmica
    criada_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    ultima_acao_em      DATETIME,
    ativa               INTEGER DEFAULT 1,  -- 0 = dissolvida/destruída
    poder_retencao      REAL DEFAULT 1.0,   -- Multiplicador de degradação (1.0 = normal, <1 = morre rápido)
    
    atualizado_em       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reputacao_jogador (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id  INTEGER NOT NULL,
    faccao_id   INTEGER NOT NULL,
    valor       INTEGER DEFAULT 0,  -- -100 a +100 (inimigo total a aliado total)
    status      TEXT DEFAULT 'neutro',  -- 'aliado'|'neutro'|'inimigo'
    desconto    REAL DEFAULT 1.0,   -- Multiplicador de preço em transações
    acesso      INTEGER DEFAULT 0,  -- 1 = pode acessar áreas secretas
    ultima_mudanca DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(jogador_id, faccao_id),
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE,
    FOREIGN KEY (faccao_id) REFERENCES faccoes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS aliancas_faccoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faccao_a_id INTEGER NOT NULL,
    faccao_b_id INTEGER NOT NULL,
    tipo        TEXT NOT NULL,  -- 'alianca'|'neutralidade'|'guerra'
    forca       INTEGER DEFAULT 50,  -- 0-100 (força da aliança/conflito)
    criada_em   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(faccao_a_id, faccao_b_id),
    FOREIGN KEY (faccao_a_id) REFERENCES faccoes(id) ON DELETE CASCADE,
    FOREIGN KEY (faccao_b_id) REFERENCES faccoes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS acoes_faccoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faccao_id   INTEGER NOT NULL,
    tipo        TEXT NOT NULL,  -- 'ataque'|'diplomacia'|'infiltracao'|'recrutamento'|'rituais'|'sabotagem'
    descricao   TEXT,
    alvo_faccao_id INTEGER,  -- Se houver alvo específico
    alvo_jogador_id INTEGER,  -- Se o jogador foi alvo
    impacto_mundo TEXT DEFAULT '{}',  -- JSON com deltas de contadores
    resultado   TEXT,  -- 'sucesso'|'falha'|'neutro'
    criada_em   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faccao_id) REFERENCES faccoes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS historico_faccoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faccao_id   INTEGER NOT NULL,
    evento      TEXT NOT NULL,  -- 'criada'|'acao'|'mudanca_poder'|'alianca'|'morte_lider'|'dissolvida'
    descricao   TEXT,
    poder_antes INTEGER,
    poder_depois INTEGER,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faccao_id) REFERENCES faccoes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_faccoes_nome ON faccoes(nome);
  CREATE INDEX IF NOT EXISTS idx_faccoes_ativa ON faccoes(ativa);
  CREATE INDEX IF NOT EXISTS idx_rep_jogador ON reputacao_jogador(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_rep_faccao ON reputacao_jogador(faccao_id);
  CREATE INDEX IF NOT EXISTS idx_aliancas_a ON aliancas_faccoes(faccao_a_id);
  CREATE INDEX IF NOT EXISTS idx_aliancas_b ON aliancas_faccoes(faccao_b_id);
`);

// ==========================================
// CONFIGURAÇÃO INICIAL — FACÇÕES PADRÃO DE VEXON
// ==========================================

/**
 * Cria as facções iniciais de Vexon se não existirem.
 * Chamado uma única vez na inicialização.
 */
export function inicializarFaccoesVexon() {
  const faccoesExistentes = db.prepare("SELECT COUNT(*) as total FROM faccoes").get().total;
  if (faccoesExistentes > 0) return; // Já inicializado

  const faccoesPadrao = [
    {
      nome: "A Irmandade",
      descricao: "Organização milenar de assassinos e magos anciãos, liderada por Noctis e o Conselho dos Três (Fogo, Gelo e Sombras). Busca o domínio fundindo ciência e o oculto.",
      tipo: "irmandade",
      poder: 60,
      moralidade: "maligno",
      lider_nome: "Noctis e o Conselho dos Três (Fogo, Gelo e Sombras)",
      objetivo_principal: "Implementar a Noite Vermelha 2.0 para controle mental passivo.",
      alinhamento_vexon: "caotica",
      territorio: toJson(["Bairro das Lanternas Azuis", "Torre da Eclipsa"]),
      poder_retencao: 0.95,
    },
    {
      nome: "Darvoss Dynamics",
      descricao: "Megacorporação biotecnológica. Experimenta com DNA e evoluções forçadas.",
      tipo: "corporacao",
      poder: 70,
      moralidade: "maligno",
      lider_nome: "Mikael Darvoss (CEO)",
      objetivo_principal: "Criar super-soldados via Projeto Genesis e Σ-Prime.",
      alinhamento_vexon: "neutra",
      territorio: toJson(["Darvoss Tower", "Laboratórios Clandestinos"]),
      poder_retencao: 0.98,
    },
    {
      nome: "VarnX Core",
      descricao: "Operação de resistência secreta de Darian Varkos (\"Noctark\"), bilionário de dia e vigilante letal à noite, com uma equipe de apoio (Aline Ventris, Kai Solano, Elin Mirae, Juno Karse).",
      tipo: "resistencia",
      poder: 30,
      moralidade: "bom",
      lider_nome: "Darian Varkos (Noctark)",
      objetivo_principal: "Destruir A Irmandade e libertar Vexon.",
      alinhamento_vexon: "leal",
      territorio: toJson(["Coração Sombrio", "Base Sentinela"]),
      poder_retencao: 1.05,
    },
    {
      nome: "Remanescentes de Corven",
      descricao: "Cientistas e agentes da corporação caída VarnCore. Operam nas sombras.",
      tipo: "corporacao",
      poder: 25,
      moralidade: "neutro",
      lider_nome: "Dr. Ilyas Corven",
      objetivo_principal: "Curar a doença de Naya; continuar pesquisa bioenergética.",
      alinhamento_vexon: "neutra",
      territorio: toJson(["Laboratórios Secretos"]),
      poder_retencao: 0.85,
    },
    {
      nome: "O Vácuo",
      descricao: "Culto de anarquistas e terroristas cósmicos que busca a ruína da realidade, a quebra da mente e o colapso estrutural. Usa equipamentos que distorcem a realidade.",
      tipo: "cult",
      poder: 20,
      moralidade: "maligno",
      lider_nome: "O Julgador do Abismo",
      objetivo_principal: "Colapso estrutural da realidade em torno de Vexon.",
      alinhamento_vexon: "caotica",
      territorio: toJson(["Tir-Naleth"]),
      poder_retencao: 0.9,
    },
    {
      nome: "Mercado Negro",
      descricao: "Rede de traficantes, contrabandistas e informantes.",
      tipo: "criminal",
      poder: 45,
      moralidade: "neutro",
      lider_nome: "Sombra",
      objetivo_principal: "Lucrar com informações e contrabandeados.",
      alinhamento_vexon: "caotica",
      territorio: toJson(["Becos de Vexon", "Linha Morta"]),
      poder_retencao: 1.02,
    },
    {
      nome: "Ordem dos Sussurradores",
      descricao: "Guardiões de magia verdadeira. Preservam conhecimento antigo.",
      tipo: "outro",
      poder: 35,
      moralidade: "bom",
      lider_nome: "Vesper (Falecida) → Nireva Nocturne",
      objetivo_principal: "Proteger o Grimório de Umbros e impedir a profanação mágica.",
      alinhamento_vexon: "leal",
      territorio: toJson(["Santuários Ocultos"]),
      poder_retencao: 1.08,
    },
  ];

  for (const faccao of faccoesPadrao) {
    criarFaccao(faccao);
  }

  // Cria alianças padrão
  const irmandade = getFaccaoPorNome("A Irmandade");
  const darvoss = getFaccaoPorNome("Darvoss Dynamics");
  const varnxcore = getFaccaoPorNome("VarnX Core");
  const remanescentes = getFaccaoPorNome("Remanescentes de Corven");
  const mercado = getFaccaoPorNome("Mercado Negro");
  const sussurradores = getFaccaoPorNome("Ordem dos Sussurradores");
  const vacuo = getFaccaoPorNome("O Vácuo");

  // Alianças
  criarAlianca(irmandade.id, darvoss.id, "alianca", 75);
  criarAlianca(varnxcore.id, sussurradores.id, "alianca", 70);
  criarAlianca(remanescentes.id, darvoss.id, "neutralidade", 50);
  criarAlianca(mercado.id, irmandade.id, "neutralidade", 45);
  criarAlianca(varnxcore.id, irmandade.id, "guerra", 85);
  criarAlianca(varnxcore.id, darvoss.id, "guerra", 80);
  criarAlianca(vacuo.id, sussurradores.id, "guerra", 60);

  console.log("[FactionEngine] Facções de Vexon inicializadas.");
}

// ==========================================
// CRUD DE FACÇÕES
// ==========================================

/**
 * Cria uma nova facção.
 * Pode ser chamado pela IA para gerar facções dinâmicas.
 */
export function criarFaccao(dados) {
  const {
    nome,
    descricao = "",
    tipo = "outro",
    poder = 50,
    moralidade = "neutro",
    lider_npc_id = null,
    lider_nome = "Desconhecido",
    objetivo_principal = "",
    objetivo_secundario = null,
    alinhamento_vexon = "neutra",
    territorio = [],
    ouro_tesouro = 1000,
    recrutados = 0,
    poder_retencao = 1.0,
  } = dados;

  const result = db.prepare(`
    INSERT INTO faccoes (
      nome, descricao, tipo, poder, moralidade,
      lider_npc_id, lider_nome,
      objetivo_principal, objetivo_secundario,
      alinhamento_vexon, territorio,
      ouro_tesouro, recrutados, poder_retencao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nome, descricao, tipo, poder, moralidade,
    lider_npc_id, lider_nome,
    objetivo_principal, objetivo_secundario,
    alinhamento_vexon, toJson(territorio),
    ouro_tesouro, recrutados, poder_retencao
  );

  const faccaoId = result.lastInsertRowid;
  registrarHistoricoFaccao(faccaoId, "criada", `Facção "${nome}" foi criada.`, null, poder);
  logWorldEvent("faccao_criada", `[${tipo}] ${nome} nasceu em Vexon.`, []);

  return faccaoId;
}

/**
 * Retorna uma facção por ID.
 */
export function getFaccaoById(faccao_id) {
  const faccao = db.prepare("SELECT * FROM faccoes WHERE id = ?").get(faccao_id);
  if (!faccao) return null;

  faccao.territorio = parseJson(faccao.territorio, []);
  return faccao;
}

/**
 * Retorna uma facção por nome.
 */
export function getFaccaoPorNome(nome) {
  const faccao = db.prepare("SELECT * FROM faccoes WHERE nome = ?").get(nome);
  if (!faccao) return null;

  faccao.territorio = parseJson(faccao.territorio, []);
  return faccao;
}

/**
 * Retorna todas as facções ativas.
 */
export function getFaccoesAtivas() {
  const faccoes = db.prepare("SELECT * FROM faccoes WHERE ativa = 1 ORDER BY poder DESC").all();
  return faccoes.map(f => ({ ...f, territorio: parseJson(f.territorio, []) }));
}

/**
 * Atualiza o poder de uma facção.
 */
export function atualizarPoderFaccao(faccao_id, novoValor) {
  const faccao = getFaccaoById(faccao_id);
  if (!faccao) throw new Error(`Facção ${faccao_id} não encontrada.`);

  const final = Math.max(0, Math.min(100, novoValor));
  db.prepare("UPDATE faccoes SET poder = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
    .run(final, faccao_id);

  registrarHistoricoFaccao(faccao_id, "mudanca_poder", `Poder alterado: ${faccao.poder} → ${final}`, faccao.poder, final);

  // Se poder chegar a 0, dissolve a facção
  if (final === 0) {
    dissolverFaccao(faccao_id, "Poder total dissipado");
  }

  return final;
}

/**
 * Dissolve uma facção permanentemente.
 */
export function dissolverFaccao(faccao_id, motivo = "Desconhecido") {
  const faccao = getFaccaoById(faccao_id);
  if (!faccao) return;

  db.prepare("UPDATE faccoes SET ativa = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?").run(faccao_id);
  registrarHistoricoFaccao(faccao_id, "dissolvida", `Facção dissolvida: ${motivo}`, faccao.poder, 0);

  logWorldEvent(
    "faccao_dissolvida",
    `[${faccao.tipo}] ${faccao.nome} foi dissolvida. Razão: ${motivo}`,
    []
  );
}

// ==========================================
// REPUTAÇÃO COM JOGADOR
// ==========================================

/**
 * Obtém ou cria a reputação do jogador com uma facção.
 */
export function getReputacao(jogador_id, faccao_id) {
  let rep = db.prepare(`
    SELECT * FROM reputacao_jogador
    WHERE jogador_id = ? AND faccao_id = ?
  `).get(jogador_id, faccao_id);

  if (!rep) {
    // Cria reputação neutra por padrão
    db.prepare(`
      INSERT INTO reputacao_jogador (jogador_id, faccao_id, valor, status)
      VALUES (?, ?, 0, 'neutro')
    `).run(jogador_id, faccao_id);

    rep = db.prepare(`
      SELECT * FROM reputacao_jogador
      WHERE jogador_id = ? AND faccao_id = ?
    `).get(jogador_id, faccao_id);
  }

  return rep;
}

/**
 * Modifica a reputação do jogador com uma facção.
 * Retorna o novo valor e o status resultante.
 */
export function modificarReputacao(jogador_id, faccao_id, delta) {
  const rep = getReputacao(jogador_id, faccao_id);
  const novoValor = Math.max(-100, Math.min(100, rep.valor + delta));

  let novoStatus = "neutro";
  if (novoValor >= 50) novoStatus = "aliado";
  else if (novoValor <= -50) novoStatus = "inimigo";

  const desconto = novoStatus === "aliado" ? 0.75 : novoStatus === "inimigo" ? 1.5 : 1.0;
  const acesso = novoStatus === "aliado" ? 1 : 0;

  db.prepare(`
    UPDATE reputacao_jogador
    SET valor = ?, status = ?, desconto = ?, acesso = ?, ultima_mudanca = CURRENT_TIMESTAMP
    WHERE jogador_id = ? AND faccao_id = ?
  `).run(novoValor, novoStatus, desconto, acesso, jogador_id, faccao_id);

  // Log
  const faccao = getFaccaoById(faccao_id);
  logWorldEvent(
    "reputacao_mudou",
    `[${faccao.nome}] Reputação do jogador ${jogador_id}: ${rep.valor} → ${novoValor}`,
    [jogador_id, faccao_id]
  );

  return { valor: novoValor, status: novoStatus, desconto, acesso };
}

/**
 * Retorna todas as reputações de um jogador.
 */
export function getReputacoesDojogador(jogador_id) {
  return db.prepare(`
    SELECT rj.*, f.nome as faccao_nome, f.tipo
    FROM reputacao_jogador rj
    JOIN faccoes f ON rj.faccao_id = f.id
    WHERE rj.jogador_id = ?
    ORDER BY rj.valor DESC
  `).all(jogador_id);
}

// ==========================================
// ALIANÇAS E CONFLITOS ENTRE FACÇÕES
// ==========================================

/**
 * Cria ou atualiza uma aliança/neutralidade/guerra entre duas facções.
 */
export function criarAlianca(faccao_a_id, faccao_b_id, tipo, forca = 50) {
  // Garante que a < b para evitar duplicatas
  const [id1, id2] = faccao_a_id < faccao_b_id ? [faccao_a_id, faccao_b_id] : [faccao_b_id, faccao_a_id];

  const existente = db.prepare(`
    SELECT * FROM aliancas_faccoes
    WHERE faccao_a_id = ? AND faccao_b_id = ?
  `).get(id1, id2);

  if (existente) {
    db.prepare(`
      UPDATE aliancas_faccoes
      SET tipo = ?, forca = ?
      WHERE faccao_a_id = ? AND faccao_b_id = ?
    `).run(tipo, forca, id1, id2);
  } else {
    db.prepare(`
      INSERT INTO aliancas_faccoes (faccao_a_id, faccao_b_id, tipo, forca)
      VALUES (?, ?, ?, ?)
    `).run(id1, id2, tipo, forca);
  }

  const fac1 = getFaccaoById(id1);
  const fac2 = getFaccaoById(id2);
  logWorldEvent(
    "alianca_faccoes",
    `${fac1.nome} ${tipo} com ${fac2.nome} (força: ${forca}%)`,
    [id1, id2]
  );
}

/**
 * Retorna todas as alianças de uma facção.
 */
export function getAliancas(faccao_id) {
  const aliacasA = db.prepare(`
    SELECT af.*, f.nome as aliado_nome, f.poder as aliado_poder
    FROM aliancas_faccoes af
    JOIN faccoes f ON af.faccao_b_id = f.id
    WHERE af.faccao_a_id = ?
  `).all(faccao_id);

  const aliancasB = db.prepare(`
    SELECT af.*, f.nome as aliado_nome, f.poder as aliado_poder
    FROM aliancas_faccoes af
    JOIN faccoes f ON af.faccao_a_id = f.id
    WHERE af.faccao_b_id = ?
  `).all(faccao_id);

  return [...aliacasA, ...aliancasB];
}

// ==========================================
// AÇÕES DE FACÇÃO
// ==========================================

/**
 * Registra uma ação de facção e aplica impacto no mundo.
 */
export function executarAcaoFaccao(faccao_id, tipo, descricao, alvo_faccao_id = null, alvo_jogador_id = null, impacto_mundo = {}, resultado = "sucesso") {
  const faccao = getFaccaoById(faccao_id);
  if (!faccao) throw new Error(`Facção ${faccao_id} não encontrada.`);

  // Aplica impacto no mundo
  for (const [chave, delta] of Object.entries(impacto_mundo)) {
    deltaWorldState(chave, delta);
  }

  // Registra ação
  const result = db.prepare(`
    INSERT INTO acoes_faccoes (faccao_id, tipo, descricao, alvo_faccao_id, alvo_jogador_id, impacto_mundo, resultado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(faccao_id, tipo, descricao, alvo_faccao_id, alvo_jogador_id, toJson(impacto_mundo), resultado);

  db.prepare("UPDATE faccoes SET ultima_acao_em = CURRENT_TIMESTAMP WHERE id = ?").run(faccao_id);

  logWorldEvent(
    "acao_faccao",
    `[${faccao.nome}] ${tipo}: ${descricao} (${resultado})`,
    alvo_faccao_id ? [faccao_id, alvo_faccao_id] : [faccao_id]
  );

  return result.lastInsertRowid;
}

/**
 * Retorna histórico de ações de uma facção.
 */
export function getAcoesFaccao(faccao_id, limit = 20) {
  return db.prepare(`
    SELECT * FROM acoes_faccoes
    WHERE faccao_id = ?
    ORDER BY criada_em DESC
    LIMIT ?
  `).all(faccao_id, limit);
}

// ==========================================
// HISTÓRICO
// ==========================================

/**
 * Registra um evento no histórico de uma facção.
 */
export function registrarHistoricoFaccao(faccao_id, evento, descricao, poder_antes, poder_depois) {
  db.prepare(`
    INSERT INTO historico_faccoes (faccao_id, evento, descricao, poder_antes, poder_depois)
    VALUES (?, ?, ?, ?, ?)
  `).run(faccao_id, evento, descricao, poder_antes, poder_depois);
}

/**
 * Retorna histórico completo de uma facção.
 */
export function getHistoricoFaccao(faccao_id, limit = 20) {
  return db.prepare(`
    SELECT * FROM historico_faccoes
    WHERE faccao_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(faccao_id, limit);
}

// ==========================================
// DEGRADAÇÃO PASSIVA DE PODER
// ==========================================

/**
 * Processa degradação passiva de poder das facções.
 * Chamado periodicamente pelo servidor (a cada 5 ticks do mundo, ~50 min).
 *
 * Facções perdem poder se não fizerem ações, ganham com poder_retencao > 1.0
 */
export function processarDegradacaoFaccoes() {
  const faccoes = getFaccoesAtivas();
  const degradacaoTaxa = 1; // perdem 1 ponto por processamento

  for (const faccao of faccoes) {
    // CORREÇÃO: O multiplicador afeta apenas o dano (a taxa de degradação)
    // Quanto maior a retenção, menor a perda real.
    const perdaReal = degradacaoTaxa / faccao.poder_retencao; 

    // Subtrai a perda real do poder atual
    const novoPoderFinal = faccao.poder - perdaReal;

    atualizarPoderFaccao(faccao.id, Math.round(novoPoderFinal));
  }

  console.log(`[FactionEngine] Degradação processada para ${faccoes.length} facções.`);
}

// ==========================================
// ESTATÍSTICAS E BALANÇA
// ==========================================

/**
 * Retorna estatísticas gerais de todas as facções.
 */
export function getEstatisticasFaccoes() {
  const faccoes = getFaccoesAtivas();
  const totalPoder = faccoes.reduce((acc, f) => acc + f.poder, 0);

  return {
    total_ativas: faccoes.length,
    poder_total: totalPoder,
    poder_medio: faccoes.length > 0 ? Math.round(totalPoder / faccoes.length) : 0,
    faccoes: faccoes.map(f => ({
      nome: f.nome,
      tipo: f.tipo,
      poder: f.poder,
      percentual_poder: faccoes.length > 0 ? Math.round((f.poder / totalPoder) * 100) : 0,
      lider: f.lider_nome,
      moralidade: f.moralidade,
    })),
  };
}

/**
 * Retorna o equilíbrio de poder entre facções.
 * Útil para o narratorEngine ajustar o tom da narrativa.
 */
export function getEquilibrioPoder() {
  const faccoes = getFaccoesAtivas();
  const boas = faccoes.filter(f => f.moralidade === "bom").reduce((acc, f) => acc + f.poder, 0);
  const neutras = faccoes.filter(f => f.moralidade === "neutro").reduce((acc, f) => acc + f.poder, 0);
  const malvadas = faccoes.filter(f => f.moralidade === "maligno").reduce((acc, f) => acc + f.poder, 0);

  return {
    bom: boas,
    neutro: neutras,
    maligno: malvadas,
    tendencia: boas > malvadas ? "bom" : malvadas > boas ? "maligno" : "neutro",
  };
}
// ==========================================
// AÇÕES PREDEFINIDAS DE FACÇÃO
// ==========================================

/**
 * Mapa de ações predefinidas por tipo de facção.
 * Usadas quando a IA não consegue gerar ou em modo offline.
 */
const ACOES_PREDEFINIDAS = {
  irmandade: [
    {
      tipo: "rituais",
      descricao: "Ritual de magia sintética executado",
      impacto: { poder_irmandade: +2, rachadura_selo: +1 },
      resultado: "sucesso",
    },
    {
      tipo: "recrutamento",
      descricao: "Novos cultistas recrutados nas periferias",
      impacto: { poder_irmandade: +3 },
      resultado: "sucesso",
    },
    {
      tipo: "infiltracao",
      descricao: "Agentes infiltrados em instituições públicas",
      impacto: { nivel_quasiluz: +3 },
      resultado: "sucesso",
    },
  ],
  darvoss: [
    {
      tipo: "sabotagem",
      descricao: "Novo setor de Quasiluz ativado",
      impacto: { nivel_quasiluz: +5, poder_darvoss: +2 },
      resultado: "sucesso",
    },
    {
      tipo: "recrutamento",
      descricao: "Crianças sequestradas para Projeto Genesis",
      impacto: { criancas_desaparecidas: +3, poder_darvoss: +2 },
      resultado: "sucesso",
    },
    {
      tipo: "ataque",
      descricao: "Ataque corporativo contra concorrentes",
      impacto: { poder_darvoss: +1 },
      resultado: "sucesso",
    },
  ],
  resistencia: [
    {
      tipo: "ataque",
      descricao: "Operação de resgate executada com sucesso",
      impacto: { criancas_desaparecidas: -2, poder_resistencia: +2 },
      resultado: "sucesso",
    },
    {
      tipo: "infiltracao",
      descricao: "Dados corporativos obtidos via hacking",
      impacto: { poder_darvoss: -2, poder_resistencia: +1 },
      resultado: "sucesso",
    },
    {
      tipo: "diplomacia",
      descricao: "Aliança fortalecida com NPCs locais",
      impacto: { poder_resistencia: +2 },
      resultado: "sucesso",
    },
  ],
};

/**
 * Seleciona uma ação predefinida aleatória para uma facção.
 */
function selecionarAcaoPredefinida(faccao_tipo) {
  const acoes = ACOES_PREDEFINIDAS[faccao_tipo] || ACOES_PREDEFINIDAS.irmandade;
  return acoes[Math.floor(Math.random() * acoes.length)];
}

// ==========================================
// GERADOR DE FACÇÕES DINÂMICAS (IA)
// ==========================================

/**
 * Gera uma nova facção completamente via IA.
 * Criada por eventos do mundo ou por NPCs que conquistam poder.
 *
 * @param {object} contexto - Contexto para a IA
 *   - nome_sugestao: sugestão de nome
 *   - tipo_preferido: tipo desejado
 *   - poder_inicial: poder inicial (1-100)
 * @returns {Promise<{faccao_id, nome, tipo, ...}>}
 */
export async function gerarFaccaoDinamica(contexto = {}) {
  const {
    nome_sugestao = null,
    tipo_preferido = null,
    poder_inicial = 30,
    lider_npc_nome = null,
  } = contexto;

  const estado = getFullWorldState();
  const faccoesCont = getFaccoesAtivas();

  const prompt = `${TOM_VEXON}

Você é o criador de facções para o RPG Vexon. Gere UMA facção nova, dinâmica e coerente com o caos de Vexon.

Estado do Mundo:
- Grande Selo ${estado.rachadura_selo}% rachado
- Quasiluz ${estado.nivel_quasiluz}% de contaminação
- Irmandade ${estado.poder_irmandade}% de poder
- VarnX Core ${estado.poder_resistencia}% de poder
- ${faccoesCont.length} facções já existem

${nome_sugestao ? `Nome sugerido: ${nome_sugestao}` : ""}
${tipo_preferido ? `Tipo preferido: ${tipo_preferido}` : ""}
${lider_npc_nome ? `Liderança: ${lider_npc_nome}` : ""}

Gere SOMENTE um JSON válido, sem texto antes ou depois:
{
  "nome": "Nome único e épico para a facção",
  "descricao": "1-2 frases descrevendo a facção",
  "tipo": "irmandade|corporacao|resistencia|criminal|cult|mercado|outro",
  "moralidade": "bom|neutro|maligno",
  "poder": número entre 10 e 80,
  "lider_nome": "Nome do líder",
  "objetivo_principal": "Objetivo principal em texto",
  "alinhamento_vexon": "leal|neutra|caotica",
  "territorio": ["Local 1", "Local 2"],
  "poder_retencao": número entre 0.8 e 1.2
}`;

  try {
    const raw = await callOllamaWorld([
      { role: "system", content: "Você é o criador de facções. Responda APENAS com JSON válido." },
      { role: "user", content: prompt },
    ], { num_predict: 300, temperature: 0.85 });

    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Nenhum JSON válido encontrado.");

    const faccaoData = JSON.parse(match[0]);

    // Cria a facção
    const faccaoId = criarFaccao({
      nome: faccaoData.nome,
      descricao: faccaoData.descricao,
      tipo: faccaoData.tipo,
      poder: Math.min(100, Math.max(10, faccaoData.poder)),
      moralidade: faccaoData.moralidade,
      lider_nome: faccaoData.lider_nome,
      objetivo_principal: faccaoData.objetivo_principal,
      alinhamento_vexon: faccaoData.alinhamento_vexon,
      territorio: faccaoData.territorio || [],
      poder_retencao: Math.max(0.5, Math.min(1.5, faccaoData.poder_retencao)),
    });

    logWorldEvent(
      "faccao_ia_criada",
      `[${faccaoData.tipo}] ${faccaoData.nome} nasceu dinamicamente em Vexon.`,
      []
    );

    return {
      faccao_id: faccaoId,
      nome: faccaoData.nome,
      tipo: faccaoData.tipo,
      poder: faccaoData.poder,
      lider: faccaoData.lider_nome,
    };
  } catch (err) {
    console.error("[FactionEngine] Geração dinâmica falhou:", err.message);
    return null;
  }
}

// ==========================================
// EXECUÇÃO DE AÇÕES DE FACÇÃO
// ==========================================

/**
 * Executa a ação de uma facção no mundo.
 * Híbrido: tenta IA primeiro, cai em predefinidas se falhar.
 *
 * @param {number} faccao_id
 * @param {string} modo - "ia"|"predefinida"|"hibrido"
 */
export async function executarAcaoFaccao_Wrapper(faccao_id, modo = "hibrido") {
  const faccao = getFaccaoById(faccao_id);
  if (!faccao) throw new Error(`Facção ${faccao_id} não encontrada.`);

  let acao = null;

  if (modo === "ia" || modo === "hibrido") {
    try {
      acao = await gerarAcaoFaccaoIA(faccao);
    } catch (err) {
      if (modo === "ia") throw err;
      console.warn(`[FactionEngine] IA falhou, usando predefinida para ${faccao.nome}`);
    }
  }

  if (!acao) {
    acao = selecionarAcaoPredefinida(faccao.tipo);
  }

  // Executa a ação
  const acao_id = executarAcaoFaccao(
    faccao_id,
    acao.tipo,
    acao.descricao,
    null,
    null,
    acao.impacto,
    acao.resultado
  );

  // Atualiza poder baseado em resultado
  if (acao.resultado === "sucesso") {
    const delta = Math.round(Object.values(acao.impacto ?? {})
      .filter(v => typeof v === "number")
      .reduce((a, b) => a + b, 0) / 5);
    atualizarPoderFaccao(faccao_id, faccao.poder + delta);
  }

  return acao;
}

/**
 * Gera uma ação de facção via IA.
 */
async function gerarAcaoFaccaoIA(faccao) {
  const estado = getFullWorldState();
  const aliancas = getAliancas(faccao.id);

  const prompt = `${TOM_VEXON}

Você é o estrategista de uma facção em Vexon.

Facção: ${faccao.nome}
Tipo: ${faccao.tipo}
Poder: ${faccao.poder}%
Objetivo: ${faccao.objetivo_principal}

Estado do Mundo: Selo ${estado.rachadura_selo}% | Quasiluz ${estado.nivel_quasiluz}% | Irmandade ${estado.poder_irmandade}%

Aliados: ${aliancas.filter(a => a.tipo === "alianca").map(a => a.aliado_nome).join(", ") || "Nenhum"}
Inimigos: ${aliancas.filter(a => a.tipo === "guerra").map(a => a.aliado_nome).join(", ") || "Nenhum"}

Gere UMA ação estratégica que faz sentido com o contexto. JSON APENAS:
{
  "tipo": "ataque|sabotagem|diplomacia|recrutamento|infiltracao|rituais",
  "descricao": "Descrição breve da ação",
  "impacto": { "chave_contador": delta (número) },
  "resultado": "sucesso|falha|neutro"
}`;

  const raw = await callOllamaWorld([
    { role: "system", content: "Você é estrategista. Responda APENAS com JSON." },
    { role: "user", content: prompt },
  ], { num_predict: 200, temperature: 0.8 });

  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Nenhum JSON válido.");

  return JSON.parse(match[0]);
}

// ==========================================
// IMPACTO DO JOGADOR NA REPUTAÇÃO
// ==========================================

/**
 * Ajusta reputação do jogador com uma facção baseado em suas ações.
 * Chamada pelo gameEngine após actions significativas.
 *
 * @param {number} jogador_id
 * @param {string} tipo_acao - "matou_membro"|"ajudou_faccao"|"sabotagemhalt"|"roubou_ouro"|etc
 * @param {number} faccao_id
 */
export function atualizarReputacaoPorAcao(jogador_id, tipo_acao, faccao_id) {
  const faccao = getFaccaoById(faccao_id);
  if (!faccao) return null;

  const deltasMapa = {
    matou_membro_irmandade: { irmandade: -10, resistencia: +5 },
    matou_membro_darvoss: { darvoss: -10, resistencia: +5 },
    resgatou_criancas: { darvoss: -15, resistencia: +10, irmandade: -5 },
    ajudou_mercado: { mercado: +10 },
    sabotou_transmissor: { darvoss: -10, nivel_quasiluz: -10 }, // nivel_quasiluz é estado do mundo
    roubou_ouro_faccao: { [faccao.nome]: -15 },
    intermediou_alianca: { resistencia: +5, sussurradores: +5 },
  };

  const deltas = deltasMapa[tipo_acao] || {};
  const resultado = {};

  for (const [nomeOuId, delta] of Object.entries(deltas)) {
    // 1. Exceção para variáveis globais do mundo
    if (nomeOuId === "nivel_quasiluz" || nomeOuId === "rachadura_selo") {
      deltaWorldState(nomeOuId, delta);
      resultado[nomeOuId] = "Mundo Atualizado";
      continue; // Pula a parte de reputação e vai para o próximo item
    }

    let facID = faccao_id;

    // 2. Se for nome/tipo de facção, resolve para ID
    if (isNaN(nomeOuId)) {
      const fac = getFaccoesAtivas().find(f => 
        f.nome.toLowerCase() === nomeOuId.toLowerCase() || 
        f.tipo.toLowerCase() === nomeOuId.toLowerCase()
      );
      
      if (fac) facID = fac.id;
      else continue;
    }

    // 3. Aplica a reputação
    const rep = modificarReputacao(jogador_id, facID, delta);
    resultado[nomeOuId] = rep;
  }

  return resultado;
}
// ==========================================
// ROTAS HTTP
// ==========================================

/**
 * Configura as rotas de facções no Express.
 */
export function setupFactionRoutes(app) {
  // GET - Listar todas as facções ativas
  app.get("/api/faction/all", (_req, res) => {
    try {
      const faccoes = getFaccoesAtivas();
      const stats = getEstatisticasFaccoes();
      const equilibrio = getEquilibrioPoder();
      res.json({ sucesso: true, faccoes, estatisticas: stats, equilibrio });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Detalhes de uma facção
  app.get("/api/faction/:faccao_id", (req, res) => {
    const faccao_id = Number(req.params.faccao_id);
    try {
      const faccao = getFaccaoById(faccao_id);
      if (!faccao) return res.status(404).json({ sucesso: false, erro: "Facção não encontrada." });

      const aliancas = getAliancas(faccao_id);
      const historico = getHistoricoFaccao(faccao_id, 10);
      const acoes = getAcoesFaccao(faccao_id, 10);

      res.json({ sucesso: true, faccao, aliancas, historico, acoes });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Reputação do jogador com facções
  app.get("/api/faction/reputation/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const reps = db.prepare(`
        SELECT rj.*, f.nome, f.tipo, f.poder
        FROM reputacao_jogador rj
        JOIN faccoes f ON rj.faccao_id = f.id
        WHERE rj.jogador_id = ?
        ORDER BY rj.valor DESC
      `).all(jogador_id);

      res.json({ sucesso: true, reputacoes: reps });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Gerar facção dinâmica
  app.post("/api/faction/gerar", async (req, res) => {
    const { nome_sugestao, tipo_preferido } = req.body;
    try {
      const novaFaccao = await gerarFaccaoDinamica({ nome_sugestao, tipo_preferido });
      if (!novaFaccao) return res.status(500).json({ sucesso: false, erro: "Falha na geração." });
      res.json({ sucesso: true, faccao: novaFaccao });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Executar ação de facção
  app.post("/api/faction/acao/:faccao_id", async (req, res) => {
    const faccao_id = Number(req.params.faccao_id);
    const { modo = "hibrido" } = req.body;
    try {
      const acao = await executarAcaoFaccao_Wrapper(faccao_id, modo);
      res.json({ sucesso: true, acao });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  app.post("/api/faction/alianca", (req, res) => {
    const { faccao_a_id, faccao_b_id, tipo, forca } = req.body;
    if (!faccao_a_id || !faccao_b_id || !tipo) {
      return res.status(400).json({ sucesso: false, erro: "Parâmetros obrigatórios faltando." });
    }
    try {
      criarAlianca(faccao_a_id, faccao_b_id, tipo, forca);
      res.json({ sucesso: true, mensagem: "Aliança criada." });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[FactionEngine] Rotas registradas: /api/faction/*");
}

// ==========================================
// TICKER PERIÓDICO
// ==========================================

let _factionTicker = null;

/**
 * Inicia o processamento periódico de facções.
 */
export function iniciarFactionTicker() {
  if (_factionTicker) return;

  const intervalo = (Number(process.env.FACTION_TICK_SEGUNDOS) || 300) * 1000; // Default: 5 min

  console.log(`[FactionEngine] Faction ticker iniciado — intervalo: ${intervalo / 1000}s`);

  _factionTicker = setInterval(() => {
    try {
      processarDegradacaoFaccoes();
    } catch (err) {
      console.error("[FactionEngine] Erro no ticker:", err.message);
    }
  }, intervalo);
}

/**
 * Para o processamento periódico.
 */
export function pararFactionTicker() {
  if (_factionTicker) {
    clearInterval(_factionTicker);
    _factionTicker = null;
    console.log("[FactionEngine] Faction ticker parado.");
  }
}