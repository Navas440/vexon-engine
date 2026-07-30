// ==========================================
// WORLD ENGINE — VEXON
// PARTE 1/3: Imports, DB, Estado Global, Log de Eventos
// ==========================================

import db, {
  logWorldEvent,
  getRecentEvents,
  parseJson,
  toJson,
} from "../db/database.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const TIMEOUT      = 20000;

// ==========================================
// TABELA DE ESTADO GLOBAL DO MUNDO
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS estado_mundo (
    chave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL,
    updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO estado_mundo (chave, valor) VALUES
    ('rachadura_selo',         '0'),
    ('influencia_vacuo',       '0'),
    ('nivel_quasiluz',         '10'),
    ('poder_irmandade',        '60'),
    ('poder_darvoss',          '70'),
    ('poder_resistencia',      '30'),
    ('criancas_desaparecidas', '0'),
    ('khal_reth_distancia',    '100'),
    ('tick_count',             '0'),
    ('ultimo_tick',            '0');

  CREATE TABLE IF NOT EXISTS eventos_mundo_vexon (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria   TEXT NOT NULL,
    titulo      TEXT NOT NULL,
    descricao   TEXT,
    impacto     TEXT DEFAULT '{}',
    reagiu_a    INTEGER,
    visivel_ao_jogador INTEGER DEFAULT 1,
    criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_eventos_vexon_cat ON eventos_mundo_vexon(categoria);
  CREATE INDEX IF NOT EXISTS idx_eventos_vexon_criado ON eventos_mundo_vexon(criado_em);
`);

// ==========================================
// ACESSO AO ESTADO GLOBAL
// ==========================================

export function getWorldState(chave) {
  const row = db.prepare("SELECT valor FROM estado_mundo WHERE chave = ?").get(chave);
  return row ? Number(row.valor) : 0;
}

export function setWorldState(chave, valor) {
  let final = Math.round(Number(valor));

  // Variáveis que não devem ser travadas em 100
  const chavesLivres = ["tick_count", "ultimo_tick"]; 

  if (!chavesLivres.includes(chave)) {
    // Aplica a trava de porcentagem (0-100) para todo o resto (poder, selo, etc)
    final = Math.max(0, Math.min(100, final));
  }

  db.prepare(`
    INSERT INTO estado_mundo (chave, valor, updated)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated = CURRENT_TIMESTAMP
  `).run(chave, String(final));
  
  return final;
}

export function deltaWorldState(chave, delta) {
  const atual = getWorldState(chave);
  return setWorldState(chave, atual + delta);
}

export function getFullWorldState() {
  const rows = db.prepare("SELECT chave, valor FROM estado_mundo").all();
  return Object.fromEntries(rows.map(r => [r.chave, Number(r.valor)]));
}

// ==========================================
// LOG DE EVENTOS DO MUNDO VEXON
// ==========================================

export function registrarEventoMundo(categoria, titulo, descricao, impacto = {}, reagiu_a = null, visivel = true) {
  for (const [chave, delta] of Object.entries(impacto)) {
    deltaWorldState(chave, delta);
  }

  const result = db.prepare(`
    INSERT INTO eventos_mundo_vexon (categoria, titulo, descricao, impacto, reagiu_a, visivel_ao_jogador)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(categoria, titulo, descricao, toJson(impacto), reagiu_a, visivel ? 1 : 0);

  logWorldEvent(categoria, `[Vexon] ${titulo}`, []);

  return result.lastInsertRowid;
}

export function getEventosVisiveis(limit = 10) {
  return db.prepare(`
    SELECT * FROM eventos_mundo_vexon
    WHERE visivel_ao_jogador = 1
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(limit);
}

// ==========================================
// GERADOR DE ALERTAS
// ==========================================

export function gerarAlertas(estado = null) {
  const e = estado ?? getFullWorldState();
  const alertas = [];

  if (e.rachadura_selo >= 50)
    alertas.push({ nivel: "critico", msg: `Grande Selo: ${e.rachadura_selo}% rachado. Os Vex se aproximam.` });
  if (e.influencia_vacuo >= 40)
    alertas.push({ nivel: "critico", msg: `Vácuo: ${e.influencia_vacuo}% de influência. A linguagem está falhando.` });
  if (e.nivel_quasiluz >= 60)
    alertas.push({ nivel: "aviso", msg: `Quasiluz a ${e.nivel_quasiluz}% — líderes da cidade comprometidos.` });
  if (e.criancas_desaparecidas >= 5)
    alertas.push({ nivel: "aviso", msg: `${e.criancas_desaparecidas} crianças desaparecidas — Projeto Genesis ativo.` });
  if (e.khal_reth_distancia <= 30)
    alertas.push({ nivel: "critico", msg: `Khal-Reth a ${e.khal_reth_distancia}% de distância — caçador alienígena se aproxima.` });
  if (e.poder_irmandade >= 80)
    alertas.push({ nivel: "aviso", msg: `Irmandade Varkos em ${e.poder_irmandade}% de poder — controle da cidade em risco.` });

  return alertas;
}

// ==========================================
// CLIENTE OLLAMA
// ==========================================

export async function callOllamaWorld(messages, opcoes = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        stream:   false,
        messages,
        options: { temperature: 0.8, top_p: 0.9, num_predict: 250, ...opcoes },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// HELPERS INTERNOS
// ==========================================

const _disparados      = new Map();
const _disparadosUnico = new Set();

export function _jaDisparou(id) {
  return _disparadosUnico.has(id);
}

export function _marcarDisparado(id) {
  _disparadosUnico.add(id);
  _disparados.set(id, getWorldState("tick_count"));
}

export function _jaDisparouRecentemente(id, cooldownTicks) {
  const tickDisparo = _disparados.get(id);
  if (tickDisparo === undefined) return false;
  return (getWorldState("tick_count") - tickDisparo) < cooldownTicks;
}

export function _sortearPorPeso(lista) {
  if (lista.length === 0) return null;
  const totalPeso = lista.reduce((acc, e) => acc + (e.peso ?? 1), 0);
  let rand        = Math.random() * totalPeso;
  for (const evento of lista) {
    rand -= (evento.peso ?? 1);
    if (rand <= 0) return evento;
  }
  return lista[lista.length - 1];
}
// ==========================================
// WORLD ENGINE — VEXON
// PARTE 2/3: Ameaças Cósmicas, Facções e Tick Automático
// ==========================================
// ==========================================
// SISTEMA DE AMEAÇAS CÓSMICAS
// ==========================================

const LIMIAR_SELO_CRITICO  = 75;
const LIMIAR_VACUO_CRITICO = 60;
const LIMIAR_KHAL_CHEGADA  = 10;

export function processarAmeacasCósmicas() {
  const estado     = getFullWorldState();
  const disparados = [];

  if (estado.rachadura_selo >= LIMIAR_SELO_CRITICO && !_jaDisparou("vex_atravessando")) {
    registrarEventoMundo(
      "cosmico",
      "O Grande Selo range — os Vex se aproximam",
      "A barreira cósmica que mantém a Frota Vex fora da Terra começa a ceder. " +
      "Sensores da base Sentinela detectam anomalias no campo magnético. " +
      "LYNX projeta 72h até a primeira brecha física.",
      { poder_irmandade: +5 },
      null, true
    );
    _marcarDisparado("vex_atravessando");
    disparados.push("vex_atravessando");
  }

  if (estado.influencia_vacuo >= LIMIAR_VACUO_CRITICO && !_jaDisparou("vacuo_linguagem")) {
    registrarEventoMundo(
      "cosmico",
      "O Vácuo corrói a linguagem de Vexon",
      "Relatos de moradores que esquecem palavras, sentem silêncio absoluto nos becos. " +
      "O Julgador está ativo. A sanidade coletiva da cidade começa a fragmentar.",
      { nivel_quasiluz: +8, poder_resistencia: -5 },
      null, true
    );
    _marcarDisparado("vacuo_linguagem");
    disparados.push("vacuo_linguagem");
  }

  if (estado.khal_reth_distancia <= LIMIAR_KHAL_CHEGADA && !_jaDisparou("khal_chegou")) {
    registrarEventoMundo(
      "cosmico",
      "Khal-Reth entra na atmosfera terrestre",
      "O caçador alienígena 'Aquele que Cobra' detectou as assinaturas energéticas " +
      "de Senthros e Markhan. Sua nave entrou na atmosfera. " +
      "Tecnologia de mundos mortos. Contrato ativo.",
      { poder_resistencia: -10 },
      null, true
    );
    _marcarDisparado("khal_chegou");
    disparados.push("khal_chegou");
  }

  return disparados;
}

// ==========================================
// MOVIMENTAÇÃO DE FACÇÕES
// ==========================================

const EVENTOS_IRMANDADE = [
  {
    id:        "ritual_sintetico",
    titulo:    "Ritual de Magia Sintética nos Becos",
    descricao: "Tecno-ninjas da Irmandade conduzem um ritual usando circuitos cibernéticos " +
               "e geometria estelar no Bairro das Lanternas Azuis. " +
               "Energia drenada de praticantes locais.",
    impacto:   { poder_irmandade: +2, rachadura_selo: +1, poder_resistencia: -1 },
    peso: 3,
    condicao:  (e) => e.poder_irmandade > 20,
  },
  {
    id:        "recrutamento_cultistas",
    titulo:    "Irmandade Recruta nas Periferias",
    descricao: "Agentes da Irmandade Varkos distribuem promessas de poder e proteção " +
               "nos orfanatos e becos de Nova Varnhold. Novos cultistas são iniciados.",
    impacto:   { poder_irmandade: +3, poder_resistencia: -1 },
    peso: 4,
    condicao:  (e) => e.poder_irmandade > 30,
  },
  {
    id:        "projeto_genesis_ativo",
    titulo:    "Projeto Genesis: Nova Leva de Experimentos",
    descricao: "Laboratório clandestino da Darvoss reporta nova leva de crianças " +
               "sendo submetidas ao vírus Σ-Prime. O Dr. Corven supervisiona à distância. " +
               "Objetivo: criar super-soldados para a guerra contra os Vex.",
    impacto:   { criancas_desaparecidas: +3, poder_darvoss: +2, poder_resistencia: -2 },
    peso: 2,
    condicao:  (e) => e.poder_darvoss > 40,
  },
  {
    id:        "quasiluz_expansao",
    titulo:    "Quasiluz Transmitida em Novo Setor",
    descricao: "Torres de transmissão da Darvoss Dynamics ativam novo setor de cobertura. " +
               "Líderes locais começam a mostrar sinais de Noite Vermelha 2.0: " +
               "decisões favoráveis à Irmandade sem motivação aparente.",
    impacto:   { nivel_quasiluz: +5, poder_irmandade: +2 },
    peso: 3,
    condicao:  (e) => e.nivel_quasiluz < 90 && e.poder_darvoss > 30,
  },
  {
    id:        "arconte_convoca",
    titulo:    "Arconte das Três Sombras Convoca Reunião",
    descricao: "Os Magos Anciãos de Fogo, Gelo e Sombras se reúnem. " +
               "Sinais mágicos anômalos detectados por Elin Mirae no Coração Sombrio. " +
               "Algo grande está sendo planejado.",
    impacto:   { poder_irmandade: +5, rachadura_selo: +2 },
    peso: 1,
    condicao:  (e) => e.poder_irmandade > 50,
  },
];

const EVENTOS_RESISTENCIA = [
  {
    id:        "lynx_rastreamento",
    titulo:    "LYNX Detecta Movimento Suspeito",
    descricao: "A IA LYNX de Kai Solano identifica padrão de movimentação incomum " +
               "próximo a instalações da Darvoss. Alerta enviado para a base Sentinela. " +
               "Janela de 6h para intervenção.",
    impacto:   { poder_resistencia: +2 },
    peso: 4,
    condicao:  (e) => e.poder_resistencia > 15,
  },
  {
    id:        "kai_hackeia",
    titulo:    "Kai Hackeia Servidor da Darvoss",
    descricao: "Kai Solano penetra nos servidores de comunicação interna da Darvoss Dynamics. " +
               "Dados sobre o Projeto Genesis extraídos. Contramedidas ativadas em 2h.",
    impacto:   { poder_resistencia: +3, poder_darvoss: -2 },
    peso: 2,
    condicao:  (e) => e.poder_resistencia > 20 && e.poder_darvoss > 20,
  },
  {
    id:        "elin_monitora",
    titulo:    "Dr.ª Elin Detecta Anomalia Bioenergética",
    descricao: "Do Coração Sombrio, Elin Mirae intercepta sinal de experimento ativo. " +
               "Coordenadas trianguladas em Nova Varnhold. " +
               "Possível localização de laboratório clandestino.",
    impacto:   { poder_resistencia: +1 },
    peso: 3,
    condicao:  (e) => e.poder_resistencia > 10,
  },
  {
    id:        "aline_politico",
    titulo:    "Aline Ventris Bloqueia Legislação Corporativa",
    descricao: "A executiva da Varkos HumanTech usa influência política para derrubar " +
               "projeto de lei que daria imunidade diplomática à Darvoss Dynamics. " +
               "Vitória silenciosa no campo burocrático.",
    impacto:   { poder_darvoss: -3, poder_resistencia: +2 },
    peso: 2,
    condicao:  (e) => e.poder_darvoss > 35,
  },
];

const EVENTOS_VARNCORE = [
  {
    id:        "corven_experimento",
    titulo:    "Dr. Corven Conduz Experimento Proibido",
    descricao: "Em laboratório secreto remanescente da VarnCore, o Dr. Ilyas Corven " +
               "cria nova forma de vida híbrida bioenergética. " +
               "Movido pelo desespero de curar a filha Naya.",
    impacto:   { poder_darvoss: +1, poder_resistencia: -1 },
    peso: 3,
    condicao:  (e) => e.poder_darvoss > 20,
  },
  {
    id:        "anomalia_biogenetica",
    titulo:    "Anomalia Biogenética Detectada",
    descricao: "Criatura híbrida escapa dos laboratórios VarnCore remanescentes. " +
               "Avistamentos nos becos de Nova Varnhold. " +
               "Origem: experimento de evolução forçada com DNA Σ-Prime.",
    impacto:   {},
    peso: 2,
    condicao:  (_e) => true,
  },
];

export function processarFaccoes() {
  const estado     = getFullWorldState();
  const disparados = [];

  const todasListas = [
    { lista: EVENTOS_IRMANDADE,   faccao: "irmandade"  },
    { lista: EVENTOS_RESISTENCIA, faccao: "resistencia"},
    { lista: EVENTOS_VARNCORE,    faccao: "varncore"   },
  ];

  for (const { lista, faccao } of todasListas) {
    const disponiveis = lista.filter(e =>
      e.condicao(estado) && !_jaDisparouRecentemente(e.id, 3)
    );

    if (disponiveis.length === 0) continue;

    const evento = _sortearPorPeso(disponiveis);
    if (!evento) continue;

    registrarEventoMundo("faccao", evento.titulo, evento.descricao, evento.impacto, null, true);
    _marcarDisparado(evento.id);
    disparados.push({ faccao, evento: evento.id });
  }

  return disparados;
}

// ==========================================
// SISTEMA DE TICK
// ==========================================

const TICK_INTERVAL_MS = (Number(process.env.WORLD_TICK_MINUTES) || 10) * 60 * 1000;

let _tickInterval = null;

export function processarTick(reativo = false) {
  const tickAtual = getWorldState("tick_count") + 1;
  setWorldState("tick_count", tickAtual);
  db.prepare("UPDATE estado_mundo SET valor = ?, updated = CURRENT_TIMESTAMP WHERE chave = 'ultimo_tick'")
    .run(String(Date.now()));

  if (!reativo) {
    const poderio = getWorldState("poder_irmandade");
    if (poderio > 50) deltaWorldState("rachadura_selo", +1);
    if (poderio > 70) deltaWorldState("rachadura_selo", +1);

    const quasiluz = getWorldState("nivel_quasiluz");
    if (quasiluz > 10) deltaWorldState("nivel_quasiluz", -1);

    const distancia = getWorldState("khal_reth_distancia");
    if (distancia > 0) deltaWorldState("khal_reth_distancia", -2);
  }

  const eventosFaccoes  = processarFaccoes();
  const eventosCosmicos = processarAmeacasCósmicas();
  const estado          = getFullWorldState();

  return {
    tick:             tickAtual,
    reativo,
    timestamp:        new Date().toISOString(),
    estado_atual:     estado,
    eventos_faccoes:  eventosFaccoes,
    eventos_cosmicos: eventosCosmicos,
    alertas:          gerarAlertas(estado),
  };
}

export function iniciarTickAutomatico() {
  if (_tickInterval) return;

  console.log(`[WorldEngine] Tick automático iniciado — intervalo: ${TICK_INTERVAL_MS / 60000} min`);

  _tickInterval = setInterval(() => {
    try {
      const resultado = processarTick(false);
      console.log(`[WorldEngine] Tick #${resultado.tick} — Selo: ${resultado.estado_atual.rachadura_selo}% | Quasiluz: ${resultado.estado_atual.nivel_quasiluz}%`);
    } catch (err) {
      console.error("[WorldEngine] Erro no tick automático:", err.message);
    }
  }, TICK_INTERVAL_MS);
}

export function pararTickAutomatico() {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
    console.log("[WorldEngine] Tick automático parado.");
  }
}
// ==========================================
// WORLD ENGINE — VEXON
// PARTE 3/3: Eventos Urbanos, Consequências Reativas,
//            Narração, Contexto para Prompt e Rotas Express
// ==========================================
// ==========================================
// SISTEMA DE EVENTOS URBANOS
// ==========================================

const EVENTOS_URBANOS = [
  {
    id:        "velvet_smoke_movimento",
    titulo:    "Movimento Incomum no Velvet Smoke",
    descricao: "O bar de fachada no Bairro das Lanternas Azuis recebe visitantes encapuzados. " +
               "Rumor nos becos: negociação de artefatos mágicos contrabandeados. " +
               "Possível conexão com a Ordem dos Sussurradores.",
    local:     "Bairro das Lanternas Azuis",
    impacto:   {},
    peso: 3,
    condicao:  (_e) => true,
  },
  {
    id:        "linha_morta_intrusos",
    titulo:    "Intrusos na Linha Morta",
    descricao: "Nos túneis de metrô abandonados de Nova Varnhold, grupos não identificados " +
               "foram avistados transportando caixotes. " +
               "A Linha Morta tem novos habitantes — e eles não querem ser encontrados.",
    local:     "Nova Varnhold — Linha Morta",
    impacto:   { poder_irmandade: +1 },
    peso: 2,
    condicao:  (e) => e.poder_irmandade > 20,
  },
  {
    id:        "becos_muda_dono",
    titulo:    "Beco Muda de Controle",
    descricao: "A gang que controlava o setor periférico leste de Vexon City foi dissolvida. " +
               "Poder do vácuo de controle atrai novos grupos — corporativos ou criminosos. " +
               "Oportunidade ou perigo, dependendo da abordagem.",
    local:     "Vexon City — Periferias",
    impacto:   {},
    peso: 2,
    condicao:  (_e) => true,
  },
  {
    id:        "orfanato_alerta",
    titulo:    "Diretor de Orfanato Reporta Desaparecimentos",
    descricao: "O diretor do Orfanato São Elias no setor norte tenta registrar boletim " +
               "de ocorrência, mas a polícia arquiva sem investigação. " +
               "Quatro crianças sumidas em uma semana. Testemunhas falam em 'homens de terno'.",
    local:     "Vexon City — Setor Norte",
    impacto:   { criancas_desaparecidas: +2 },
    peso: 3,
    condicao:  (e) => e.poder_darvoss > 30,
  },
  {
    id:        "preco_implantes_sobe",
    titulo:    "Preços de Implantes Cibernéticos Disparam",
    descricao: "Fornecedores de implantes do mercado negro relatam escassez repentina. " +
               "Rumores apontam que a Darvoss está comprando estoques inteiros " +
               "para uso em experimentos militares.",
    local:     "Vexon City",
    impacto:   { poder_darvoss: +1 },
    peso: 2,
    condicao:  (e) => e.poder_darvoss > 40,
  },
  {
    id:        "tir_naleth_anomalia",
    titulo:    "Anomalia Detectada em Tir-Naleth",
    descricao: "Sensores sísmicos registram atividade nos desertos fossilizados de Tir-Naleth. " +
               "Padrão incomum sugere presença de entidade ativa. " +
               "As ruínas pré-humanas guardam algo que não deveria ter despertado.",
    local:     "Tir-Naleth",
    impacto:   { influencia_vacuo: +2 },
    peso: 1,
    condicao:  (e) => e.influencia_vacuo > 10,
  },
  {
    id:        "juno_investigacao",
    titulo:    "Comissária Juno Abre Investigação Paralela",
    descricao: "Juno Karse, da Segurança Pública, abre investigação não oficial sobre " +
               "desaparecimentos no setor norte. Age fora da hierarquia, arriscando a carreira. " +
               "Ela sabe que alguém acima dela está envolvido.",
    local:     "Vexon City",
    impacto:   { poder_resistencia: +2, poder_darvoss: -1 },
    peso: 2,
    condicao:  (e) => e.criancas_desaparecidas >= 3 && e.poder_resistencia > 10,
  },
  {
    id:        "quasiluz_sintomas",
    titulo:    "Moradores Relatam Sintomas Estranhos",
    descricao: "Clínicas de saúde pública registram aumento de pacientes com 'névoa mental', " +
               "dificuldade de concentração e impulsos de obedecer figuras de autoridade. " +
               "Médicos buscam explicação. A resposta está no ar que respiram.",
    local:     "Vexon City",
    impacto:   { nivel_quasiluz: +2 },
    peso: 3,
    condicao:  (e) => e.nivel_quasiluz >= 30,
  },
];

export function processarEventosUrbanos() {
  const estado     = getFullWorldState();
  const disparados = [];

  const disponiveis = EVENTOS_URBANOS.filter(e =>
    e.condicao(estado) && !_jaDisparouUrbanRecentemente(e.id, 5)
  );

  if (disponiveis.length === 0) return disparados;

  const quantidade  = Math.min(2, disponiveis.length);
  const selecionados = _sortearMultiplosPorPeso(disponiveis, quantidade);

  for (const evento of selecionados) {
    registrarEventoMundo("urbano", evento.titulo, evento.descricao, evento.impacto, null, true);
    _marcarUrbanDisparado(evento.id);
    disparados.push(evento.id);
  }

  return disparados;
}

// ==========================================
// SISTEMA DE CONSEQUÊNCIAS REATIVAS
// ==========================================

const CONSEQUENCIAS_MAPA = {
  "derrota_irmandade": {
    impacto:   { poder_irmandade: -3, poder_resistencia: +2 },
    titulo:    "Operativo da Irmandade Eliminado",
    descricao: (ctx) => `Relatórios internos da Irmandade registram perda de agente. ` +
                        `${ctx.jogador ?? "O vigilante"} deixou uma mensagem clara nos becos.`,
    categoria: "reativo",
  },
  "resgate_criancas": {
    impacto:   { criancas_desaparecidas: -2, poder_darvoss: -2, poder_resistencia: +3 },
    titulo:    "Crianças Resgatadas do Projeto Genesis",
    descricao: (ctx) => `${ctx.jogador ?? "Agente desconhecido"} invadiu laboratório clandestino ` +
                        `e resgatou ${ctx.quantidade ?? 2} crianças. ` +
                        `A Darvoss já busca o responsável.`,
    categoria: "reativo",
  },
  "destruiu_transmissor": {
    impacto:   { nivel_quasiluz: -10, poder_darvoss: -3, poder_resistencia: +2 },
    titulo:    "Torre de Quasiluz Destruída",
    descricao: (ctx) => `Uma torre de transmissão da Darvoss Dynamics foi sabotada em ${ctx.local ?? "setor desconhecido"}. ` +
                        `Moradores do entorno relatam clareza mental repentina. ` +
                        `Darvoss envia equipe de reparo e reforço de segurança.`,
    categoria: "consequencia",
  },
  "vazou_dados_corporativos": {
    impacto:   { poder_darvoss: -8, poder_resistencia: +5, poder_irmandade: -2 },
    titulo:    "Dados Corporativos Vazados Publicamente",
    descricao: (ctx) => `Documentos confidenciais da ${ctx.corporacao ?? "corporação"} circulam na rede. ` +
                        `Mídia independente publica denúncias. ` +
                        `Ações caem. Investigações públicas são abertas.`,
    categoria: "consequencia",
  },
  "interrompeu_ritual": {
    impacto:   { rachadura_selo: -5, poder_irmandade: -4, poder_resistencia: +3 },
    titulo:    "Ritual da Irmandade Interrompido",
    descricao: (_ctx) => `O ritual de magia sintética foi interrompido antes da conclusão. ` +
                         `A rachadura no Grande Selo regrediu levemente. ` +
                         `Os Magos Anciãos convocam reunião de emergência.`,
    categoria: "consequencia",
  },
  "ativou_vacuo": {
    impacto:   { influencia_vacuo: +10, poder_resistencia: -3 },
    titulo:    "Influência do Vácuo Aumenta",
    descricao: (_ctx) => `A entidade Irra'du-Namtar fortaleceu sua presença. ` +
                         `Relatos de silêncio absoluto e perda de memória linguística aumentam. ` +
                         `O Julgador ouviu o chamado.`,
    categoria: "reativo",
  },
  "enfrentou_khal_reth": {
    impacto:   { khal_reth_distancia: +20 },
    titulo:    "Khal-Reth Recua Temporariamente",
    descricao: (ctx) => `${ctx.jogador ?? "O combatente"} forçou o caçador alienígena a recalibrar. ` +
                        `Khal-Reth se afasta para analisar a ameaça. ` +
                        `O contrato permanece ativo. Ele voltará mais preparado.`,
    categoria: "reativo",
  },
};

export function processarConsequenciaReativa(tipoAcao, contexto = {}, acao_id = null) {
  const def = CONSEQUENCIAS_MAPA[tipoAcao];
  if (!def) {
    console.warn(`[WorldEngine] Consequência desconhecida: "${tipoAcao}"`);
    return null;
  }

  const titulo    = def.titulo;
  const descricao = def.descricao(contexto);

  const eventoId = registrarEventoMundo(
    def.categoria, titulo, descricao, def.impacto, acao_id, true
  );

  processarTick(true);

  return {
    evento_id:   eventoId,
    tipo:        tipoAcao,
    titulo,
    descricao,
    impacto:     def.impacto,
    novo_estado: getFullWorldState(),
    alertas:     gerarAlertas(),
  };
}

// ==========================================
// NARRADOR DE EVENTOS DO MUNDO
// ==========================================

export async function narrarEstadoDoMundo(jogador_id, num_eventos = 5) {
  const eventos = getEventosVisiveis(num_eventos);
  const estado  = getFullWorldState();
  const alertas = gerarAlertas(estado);

  if (eventos.length === 0) {
    return "Vexon respira pesado esta noite. Nada de incomum nos radares — por enquanto.";
  }

  const resumoEventos = eventos
    .map(e => `• [${e.categoria.toUpperCase()}] ${e.titulo}: ${e.descricao}`)
    .join("\n");

  const resumoAlertas = alertas.length > 0
    ? `\nALERTAS ATIVOS:\n${alertas.map(a => `⚠ ${a.msg}`).join("\n")}`
    : "";

  const prompt = `Você é o narrador sombrio de Vexon — uma cidade cyberpunk onde magia e tecnologia colidem.
Leia os eventos recentes do mundo e narre-os em 2-3 parágrafos, segunda pessoa, tom de briefing urgente.
Não mencione categorias, IDs ou termos técnicos. Apenas narre como o estado atual da cidade.

Eventos recentes:
${resumoEventos}
${resumoAlertas}

Estado global:
- Grande Selo: ${estado.rachadura_selo}% rachado
- Quasiluz: ${estado.nivel_quasiluz}% de cobertura  
- Poder da Irmandade: ${estado.poder_irmandade}%
- Poder da Resistência: ${estado.poder_resistencia}%`;

  try {
    return await callOllamaWorld([
      { role: "system", content: "Você narra o estado do mundo sombrio de Vexon. Máximo de 3 parágrafos." },
      { role: "user",   content: prompt },
    ], { num_predict: 300 });
  } catch {
    return `Vexon nunca dorme. ${eventos[0]?.titulo ?? "A cidade ferve"} — apenas um dos sinais de que algo maior se aproxima.`;
  }
}

// ==========================================
// CONTEXTO DO MUNDO PARA O RPG MASTER
// ==========================================

export function getWorldContextForPrompt() {
  const e       = getFullWorldState();
  const alertas = gerarAlertas(e);
  const eventos = getEventosVisiveis(3);

  const linhas = [
    `Estado do mundo Vexon:`,
    `Grande Selo ${e.rachadura_selo}% | Vácuo ${e.influencia_vacuo}% | Quasiluz ${e.nivel_quasiluz}%`,
    `Irmandade ${e.poder_irmandade}% | Darvoss ${e.poder_darvoss}% | Resistência ${e.poder_resistencia}%`,
    e.criancas_desaparecidas > 0 ? `Crianças desaparecidas (Projeto Genesis): ${e.criancas_desaparecidas}` : null,
    e.khal_reth_distancia < 50   ? `Khal-Reth a ${e.khal_reth_distancia}% de distância` : null,
    alertas.length > 0 ? `Alertas: ${alertas.map(a => a.msg).join(" | ")}` : null,
    eventos.length > 0 ? `Eventos recentes: ${eventos.slice(0, 2).map(ev => ev.titulo).join(", ")}` : null,
  ].filter(Boolean);

  return linhas.join("\n");
}

// ==========================================
// DETECÇÃO AUTOMÁTICA DE CONSEQUÊNCIAS
// ==========================================

export function detectarEProcessarConsequencias(resultadoAcao, jogadorNome, localAtual) {
  const dm       = resultadoAcao?.dados_mecanicos ?? {};
  const resultados = [];

  if (dm.ataque_jogador?.alvo?.morreu) {
    const nomeAlvo = dm.ataque_jogador.alvo.nome?.toLowerCase() ?? "";
    if (/sentinela|arconte|cultista|tecno|irmandade|varkos/i.test(nomeAlvo)) {
      resultados.push(processarConsequenciaReativa(
        "derrota_irmandade",
        { jogador: jogadorNome, local: localAtual }
      ));
    }
  }

  if (dm.item && /transmissor|torre|quasiluz/i.test(dm.item)) {
    resultados.push(processarConsequenciaReativa(
      "destruiu_transmissor",
      { jogador: jogadorNome, local: localAtual }
    ));
  }

  if (dm.ataque_jogador?.alvo?.nome && /khal|caçador|alienígena/i.test(dm.ataque_jogador.alvo.nome)) {
    resultados.push(processarConsequenciaReativa(
      "enfrentou_khal_reth",
      { jogador: jogadorNome }
    ));
  }

  return resultados.filter(Boolean);
}

// ==========================================
// ROTAS DE INTEGRAÇÃO COM server.js
// ==========================================

export function setupWorldRoutes(app) {
  app.get("/api/world/state", (_req, res) => {
    res.json({ sucesso: true, estado: getFullWorldState(), alertas: gerarAlertas() });
  });

  app.get("/api/world/events", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    res.json({ sucesso: true, eventos: getEventosVisiveis(limit) });
  });

  app.get("/api/world/briefing/:jogador_id", async (req, res) => {
    try {
      const narrativa = await narrarEstadoDoMundo(Number(req.params.jogador_id));
      res.json({ sucesso: true, narrativa });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  app.post("/api/world/consequence", (req, res) => {
    const { tipo, contexto } = req.body;
    if (!tipo) return res.status(400).json({ sucesso: false, erro: "tipo é obrigatório." });
    try {
      const resultado = processarConsequenciaReativa(tipo, contexto ?? {});
      res.json({ sucesso: true, resultado });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  app.post("/api/world/tick", (_req, res) => {
    const resultado = processarTick(false);
    res.json({ sucesso: true, resultado });
  });

  console.log("[WorldEngine] Rotas registradas: /api/world/*");
}

// ==========================================
// HELPERS INTERNOS (urbanos)
// ==========================================

const _disparadosUrbanos = new Map();

function _jaDisparouUrbanRecentemente(id, cooldownTicks) {
  const tick = _disparadosUrbanos.get(id);
  if (tick === undefined) return false;
  return (getWorldState("tick_count") - tick) < cooldownTicks;
}

function _marcarUrbanDisparado(id) {
  _disparadosUrbanos.set(id, getWorldState("tick_count"));
}

function _sortearMultiplosPorPeso(lista, quantidade) {
  const resultado = [];
  const copia     = [...lista];

  for (let i = 0; i < quantidade && copia.length > 0; i++) {
    const totalPeso = copia.reduce((acc, e) => acc + (e.peso ?? 1), 0);
    let rand        = Math.random() * totalPeso;
    let idx         = 0;

    for (let j = 0; j < copia.length; j++) {
      rand -= (copia[j].peso ?? 1);
      if (rand <= 0) { idx = j; break; }
    }

    resultado.push(copia[idx]);
    copia.splice(idx, 1);
  }

  return resultado;
}