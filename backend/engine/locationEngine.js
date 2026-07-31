// ==========================================
// LOCATION ENGINE — VEXON (PARTE 1 DE 2)
// Banco, locais fixos, conteúdo próprio e viagem mecânica
// ==========================================

import db, { logWorldEvent, toJson, parseJson, getPlayer } from "../db/database.js";
import { getFullWorldState, callOllamaWorld } from "../ia/worldEngine.js";
import { TOM_VEXON } from "../loreVexon.js";

// ==========================================
// TABELAS DO BANCO DE DADOS
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS locais (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nome              TEXT NOT NULL UNIQUE,
    tipo              TEXT NOT NULL,  -- 'cidade'|'beco'|'dungeon'|'ruinas'|'laboratorio'|'base'|'exterior'
    descricao         TEXT,
    descricao_curta   TEXT,           -- 1 frase para exibição rápida no HUD

    -- Conteúdo próprio
    nivel_perigo      INTEGER DEFAULT 1,  -- 1-10 (afeta encontros e dificuldade)
    faccao_controle   TEXT,               -- Facção que controla este local
    npcs_fixos        TEXT DEFAULT '[]',  -- JSON array de nomes de NPCs residentes
    itens_locais      TEXT DEFAULT '[]',  -- JSON array de itens encontráveis
    eventos_possiveis TEXT DEFAULT '[]',  -- JSON array de IDs de eventos especiais

    -- Conexões (mapa)
    locais_conectados TEXT DEFAULT '[]',  -- JSON array de nomes de locais acessíveis
    rota_perigo       TEXT DEFAULT '{}',  -- JSON: { "nome_local_destino": nivel_perigo_da_rota }

    -- Mecânicas de viagem
    tempo_viagem_min  INTEGER DEFAULT 10, -- Minutos de tempo real para chegar de qualquer origem
    custo_viagem      INTEGER DEFAULT 0,  -- Ouro necessário para transporte (0 = a pé)
    requer_reputacao  TEXT,               -- Facção cuja reputação positiva é necessária para entrar
    restrito          INTEGER DEFAULT 0,  -- 1 = precisa de acesso especial

    -- Estado dinâmico
    descoberto        INTEGER DEFAULT 0,  -- 1 = jogador já visitou
    ativo             INTEGER DEFAULT 1,
    criado_por_ia     INTEGER DEFAULT 0,
    criado_em         DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posicao_jogador (
    jogador_id        INTEGER PRIMARY KEY,
    local_atual       TEXT NOT NULL DEFAULT 'Cidade de Vexon — Centro',
    local_anterior    TEXT,
    chegou_em         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS viagens (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id        INTEGER NOT NULL,
    origem            TEXT NOT NULL,
    destino           TEXT NOT NULL,
    status            TEXT DEFAULT 'em_viagem',  -- 'em_viagem'|'chegou'|'interrompida'
    evento_encontrado TEXT,           -- Descrição do evento encontrado na rota (se houver)
    tempo_inicio      DATETIME DEFAULT CURRENT_TIMESTAMP,
    tempo_chegada     DATETIME,
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS historico_locais (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id  INTEGER NOT NULL,
    local_nome  TEXT NOT NULL,
    acao        TEXT NOT NULL,  -- 'chegou'|'saiu'|'explorou'|'evento'
    descricao   TEXT,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_locais_nome ON locais(nome);
  CREATE INDEX IF NOT EXISTS idx_locais_tipo ON locais(tipo);
  CREATE INDEX IF NOT EXISTS idx_posicao_jogador ON posicao_jogador(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_viagens_jogador ON viagens(jogador_id);
`);

// ==========================================
// LOCAIS FIXOS DE VEXON — COMPÊNDIO INICIAL
// ==========================================

export function inicializarLocais() {
  const existentes = db.prepare("SELECT COUNT(*) as t FROM locais").get().t;
  if (existentes > 0) return;

  const locaisBase = [
    // ── VEXON CITY ──────────────────────────────────────────────────────────
    {
      nome: "Cidade de Vexon — Centro",
      tipo: "cidade",
      descricao: "Coração da metrópole sombria. Arranha-céus envidraçados, megacorporações, drones de vigilância e letreiros de neon. Névoa permanente cobre as ruas de paralelepípedo. Contraste brutal entre o luxo corporativo e a miséria dos becos.",
      descricao_curta: "Centro corporativo de Vexon. Névoa, neon e vigilância constante.",
      nivel_perigo: 3,
      faccao_controle: "Darvoss Dynamics",
      npcs_fixos: ["Juno Karse", "Aline Ventris"],
      itens_locais: ["Poção de Cura", "Kit de Ferramentas de Ladrão"],
      locais_conectados: ["Distrito Industrial de Vexon", "Becos de Vexon", "Darvoss Tower"],
      rota_perigo: { "Becos de Vexon": 5, "Darvoss Tower": 6, "Distrito Industrial de Vexon": 2 },
      tempo_viagem_min: 5,
      custo_viagem: 0,
    },
    {
      nome: "Distrito Industrial de Vexon",
      tipo: "cidade",
      descricao: "Fornalhas e martelos, cheiro de metal quente. As forjas operam 24h. Trabalhadores correm com peças cibernéticas. Mira, a Ferreira, mantém sua loja aqui — uma das poucas honestas que restam.",
      descricao_curta: "Forjas, oficinas e trabalhadores. Lar de Mira, a Ferreira.",
      nivel_perigo: 2,
      faccao_controle: "Cidadãos de Vexon",
      npcs_fixos: ["Mira, a Ferreira"],
      itens_locais: ["Metal Sombrio", "Cano de Metal", "Placas de Titânio"],
      locais_conectados: ["Cidade de Vexon — Centro", "Becos de Vexon"],
      rota_perigo: { "Becos de Vexon": 4, "Cidade de Vexon — Centro": 2 },
      tempo_viagem_min: 8,
      custo_viagem: 0,
    },
    {
      nome: "Becos de Vexon",
      tipo: "beco",
      descricao: "Labirinto de vielas úmidas e mal iluminadas. Grafite arcano nas paredes. Traficantes, informantes e desesperados disputam território. Sombra opera aqui — sabe de tudo que acontece.",
      descricao_curta: "Becos perigosos. Mercado negro e informantes.",
      nivel_perigo: 6,
      faccao_controle: "Mercado Negro",
      npcs_fixos: ["Sombra"],
      itens_locais: ["Veneno de Contato Básico", "Chip de Acesso Corporativo Falsificado", "Pó de Enxofre"],
      locais_conectados: ["Cidade de Vexon — Centro", "Distrito Industrial de Vexon", "Bairro das Lanternas Azuis"],
      rota_perigo: { "Bairro das Lanternas Azuis": 6, "Cidade de Vexon — Centro": 4 },
      tempo_viagem_min: 12,
      custo_viagem: 0,
    },
    {
      nome: "Darvoss Tower",
      tipo: "laboratorio",
      descricao: "Torre de vidro escuro e aço. Quarenta andares de laboratórios, escritórios e salas de experimentos. Guardas em cada andar. A Quasiluz é transmitida daqui. Mikael Darvoss ocupa o penúltimo andar.",
      descricao_curta: "Sede da Darvoss Dynamics. Alta segurança, Quasiluz ativa.",
      nivel_perigo: 8,
      faccao_controle: "Darvoss Dynamics",
      npcs_fixos: [],
      itens_locais: ["Amostra Σ-Prime", "Fibra Neural", "Chip Óptico", "Gel Nanomédico"],
      locais_conectados: ["Cidade de Vexon — Centro"],
      rota_perigo: { "Cidade de Vexon — Centro": 6 },
      tempo_viagem_min: 10,
      custo_viagem: 0,
      restrito: 1,
      requer_reputacao: "Darvoss Dynamics",
    },

    // ── NOVA VARNHOLD ────────────────────────────────────────────────────────
    {
      nome: "Nova Varnhold — Centro",
      tipo: "cidade",
      descricao: "Cidade vizinha ainda instável após a queda da VarnCore. Reconstrução inacabada. Cicatrizes de explosões nos edifícios. Submundo fervilhante e população desconfiada de estranhos.",
      descricao_curta: "Cidade cicatrizada pós-VarnCore. Instável e desconfiada.",
      nivel_perigo: 5,
      faccao_controle: null,
      npcs_fixos: ["Dr. Elin Mirae"],
      itens_locais: ["Extratos Bioquímicos", "Reagente Neutralizador"],
      locais_conectados: ["Cidade de Vexon — Centro", "Bairro das Lanternas Azuis", "Linha Morta", "Coração Sombrio"],
      rota_perigo: { "Cidade de Vexon — Centro": 5, "Linha Morta": 7, "Bairro das Lanternas Azuis": 4 },
      tempo_viagem_min: 20,
      custo_viagem: 30,
    },
    {
      nome: "Bairro das Lanternas Azuis",
      tipo: "beco",
      descricao: "Distrito decadente de Nova Varnhold. Lampiões azuis arcanos nas esquinas. Lojas de antiguidades ocultistas, videntes falsos e um bar de fachada chamado Velvet Smoke. A Ordem dos Sussurradores tinha raízes aqui.",
      descricao_curta: "Bairro místico decadente. Lar do Velvet Smoke.",
      nivel_perigo: 5,
      faccao_controle: "Ordem dos Sussurradores",
      npcs_fixos: [],
      itens_locais: ["Tinta de Sombra", "Runa Básica", "Cristal de Quasiluz"],
      locais_conectados: ["Nova Varnhold — Centro", "Becos de Vexon"],
      rota_perigo: { "Nova Varnhold — Centro": 4, "Becos de Vexon": 6 },
      tempo_viagem_min: 15,
      custo_viagem: 20,
    },
    {
      nome: "Linha Morta",
      tipo: "dungeon",
      descricao: "Túneis de metrô abandonados sob Nova Varnhold. Trilhos enferrujados, plataformas cobertas de lodo. Sons distantes de algo se arrastando. Grupos desconhecidos usam os túneis para contrabando. Perigoso para quem não conhece.",
      descricao_curta: "Metrô abandonado. Contrabandistas e criaturas nas sombras.",
      nivel_perigo: 7,
      faccao_controle: "Mercado Negro",
      npcs_fixos: [],
      itens_locais: ["Cano de Metal", "Invólucro Metálico", "Couro Reforçado"],
      locais_conectados: ["Nova Varnhold — Centro"],
      rota_perigo: { "Nova Varnhold — Centro": 6 },
      tempo_viagem_min: 25,
      custo_viagem: 0,
    },
    {
      nome: "Coração Sombrio",
      tipo: "base",
      descricao: "Base subterrânea secreta da VarnX Core em Nova Varnhold, operada por Darian Varkos. Túneis reforçados, servidores zumbindo, monitores cobertos de dados. Elin Mirae coordena operações táticas daqui. Elyara usa como ponto de apoio.",
      descricao_curta: "Base da VarnX Core. Segura e bem equipada.",
      nivel_perigo: 1,
      faccao_controle: "VarnX Core",
      npcs_fixos: ["Dr. Elin Mirae"],
      itens_locais: ["Poção de Cura", "Kit Cirúrgico", "Frasco Criogênico"],
      locais_conectados: ["Nova Varnhold — Centro"],
      rota_perigo: { "Nova Varnhold — Centro": 4 },
      tempo_viagem_min: 30,
      custo_viagem: 0,
      restrito: 1,
      requer_reputacao: "VarnX Core",
    },

    // ── EXTERIOR ─────────────────────────────────────────────────────────────
    {
      nome: "Tir-Naleth",
      tipo: "ruinas",
      descricao: "Desertos fossilizados a horas de Vexon. Ruínas pré-humanas e estruturas de civilizações antigas. Vento constante carrega um sussurro que não é vento. O Julgador do Abismo foi visto aqui. Pedras gravadas em idioma que ninguém traduz.",
      descricao_curta: "Deserto de ruínas antigas. O Vácuo é forte aqui.",
      nivel_perigo: 9,
      faccao_controle: null,
      npcs_fixos: [],
      itens_locais: ["Pedra de Tir-Naleth", "Essência do Vácuo", "Prata Purificada"],
      locais_conectados: ["Cidade de Vexon — Centro"],
      rota_perigo: { "Cidade de Vexon — Centro": 8 },
      tempo_viagem_min: 60,
      custo_viagem: 100,
    },
  ];

  for (const local of locaisBase) {
    db.prepare(`
      INSERT INTO locais (
        nome, tipo, descricao, descricao_curta,
        nivel_perigo, faccao_controle,
        npcs_fixos, itens_locais, locais_conectados, rota_perigo,
        tempo_viagem_min, custo_viagem,
        requer_reputacao, restrito, descoberto
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      local.nome, local.tipo, local.descricao, local.descricao_curta,
      local.nivel_perigo, local.faccao_controle ?? null,
      toJson(local.npcs_fixos ?? []),
      toJson(local.itens_locais ?? []),
      toJson(local.locais_conectados ?? []),
      toJson(local.rota_perigo ?? {}),
      local.tempo_viagem_min ?? 10,
      local.custo_viagem ?? 0,
      local.requer_reputacao ?? null,
      local.restrito ? 1 : 0,
      0
    );
  }

  console.log(`[LocationEngine] ${locaisBase.length} locais base inicializados.`);
}

// ==========================================
// CRUD DE LOCAIS
// ==========================================

export function getLocalByNome(nome) {
  const local = db.prepare("SELECT * FROM locais WHERE nome = ? AND ativo = 1").get(nome);
  if (!local) return null;
  return _hydratarLocal(local);
}

export function getLocalById(id) {
  const local = db.prepare("SELECT * FROM locais WHERE id = ? AND ativo = 1").get(id);
  if (!local) return null;
  return _hydratarLocal(local);
}

export function getLocaisAtivos() {
  return db.prepare("SELECT * FROM locais WHERE ativo = 1 ORDER BY nivel_perigo ASC").all()
    .map(_hydratarLocal);
}

export function getLocaisConectados(nome_local) {
  const local = getLocalByNome(nome_local);
  if (!local) return [];
  return local.locais_conectados
    .map(n => getLocalByNome(n))
    .filter(Boolean);
}

function _hydratarLocal(local) {
  return {
    ...local,
    npcs_fixos:        parseJson(local.npcs_fixos, []),
    itens_locais:      parseJson(local.itens_locais, []),
    locais_conectados: parseJson(local.locais_conectados, []),
    rota_perigo:       parseJson(local.rota_perigo, {}),
    eventos_possiveis: parseJson(local.eventos_possiveis, []),
  };
}

// ==========================================
// POSIÇÃO DO JOGADOR
// ==========================================

export function getPosicaoJogador(jogador_id) {
  let pos = db.prepare("SELECT * FROM posicao_jogador WHERE jogador_id = ?").get(jogador_id);
  if (!pos) {
    db.prepare(`
      INSERT INTO posicao_jogador (jogador_id, local_atual)
      VALUES (?, 'Cidade de Vexon — Centro')
    `).run(jogador_id);
    pos = db.prepare("SELECT * FROM posicao_jogador WHERE jogador_id = ?").get(jogador_id);
  }
  return pos;
}

export function setLocalJogador(jogador_id, novo_local) {
  const pos = getPosicaoJogador(jogador_id);
  db.prepare(`
    UPDATE posicao_jogador
    SET local_anterior = local_atual, local_atual = ?, chegou_em = CURRENT_TIMESTAMP
    WHERE jogador_id = ?
  `).run(novo_local, jogador_id);

  // Marca como descoberto
  db.prepare("UPDATE locais SET descoberto = 1 WHERE nome = ?").run(novo_local);

  // Registra histórico
  db.prepare(`
    INSERT INTO historico_locais (jogador_id, local_nome, acao, descricao)
    VALUES (?, ?, 'chegou', ?)
  `).run(jogador_id, novo_local, `Chegou em ${novo_local}`);

  return getPosicaoJogador(jogador_id);
}

// ==========================================
// SISTEMA DE VIAGEM MECÂNICA
// ==========================================

// Tabela de eventos possíveis durante a viagem, indexada por nível de perigo
const EVENTOS_VIAGEM = {
  baixo: [  // perigo 1-3
    { id: "patrulha_corporativa", descricao: "Uma patrulha da Darvoss bloqueia brevemente o caminho. Exige identificação.", combate: false, peso: 3 },
    { id: "mendigo_informante",   descricao: "Um mendigo sussurra uma informação útil em troca de alguns ouros.", combate: false, peso: 4 },
    { id: "nada",                 descricao: null, combate: false, peso: 8 },
  ],
  medio: [  // perigo 4-6
    { id: "emboscada_mercado_negro", descricao: "Membros do Mercado Negro tentam uma extorsão rápida.", combate: true,  peso: 3 },
    { id: "cultista_perdido",        descricao: "Um cultista da Irmandade age de forma errática. Pode ser perigoso.", combate: true,  peso: 2 },
    { id: "chuva_acida",             descricao: "Chuva ácida força abrigo temporário. Pequeno atraso.", combate: false, peso: 3 },
    { id: "drone_vigilancia",        descricao: "Drone da Darvoss registra sua passagem. Alerta possível.", combate: false, peso: 2 },
    { id: "nada",                    descricao: null, combate: false, peso: 5 },
  ],
  alto: [  // perigo 7-10
    { id: "sentinela_irmandade",  descricao: "Sentinela das Sombras patrulha o caminho. Hostil a estranhos.", combate: true,  peso: 4 },
    { id: "anomalia_biogenetica", descricao: "Criatura híbrida escapada de laboratório VarnCore bloqueia a rota.", combate: true,  peso: 3 },
    { id: "vacuo_eco",            descricao: "Ecos do Vácuo causam desorientação. Teste de sabedoria CD 14.", combate: false, peso: 2 },
    { id: "armadilha_irmandade",  descricao: "Armadilha mágica sintética. Dano se não detectar.", combate: false, peso: 2 },
    { id: "nada",                 descricao: null, combate: false, peso: 3 },
  ],
};

/**
 * Sorteia um evento de viagem por nível de perigo.
 */
export function sortearEventoViagem(nivel_perigo) {
  const categoria = nivel_perigo <= 3 ? "baixo"
                  : nivel_perigo <= 6 ? "medio"
                  : "alto";

  const lista     = EVENTOS_VIAGEM[categoria];
  const totalPeso = lista.reduce((acc, e) => acc + e.peso, 0);
  let rand        = Math.random() * totalPeso;

  for (const evento of lista) {
    rand -= evento.peso;
    if (rand <= 0) return evento;
  }

  return lista[lista.length - 1];
}

/**
 * Inicia uma viagem mecânica.
 * Registra no banco e calcula o tempo de chegada.
 *
 * @param {number} jogador_id
 * @param {string} destino - Nome do local de destino
 * @returns {{ viagem_id, tempo_chegada, evento_encontrado, pode_partir }}
 */
export function iniciarViagem(jogador_id, destino) {
  const posicao = getPosicaoJogador(jogador_id);
  const origem  = posicao.local_atual;

  if (origem === destino) throw new Error("Você já está neste local.");

  const localDestino = getLocalByNome(destino);
  if (!localDestino) throw new Error(`Local "${destino}" não encontrado.`);

  const localOrigem = getLocalByNome(origem);

  // Verifica conexão (direto ou qualquer rota)
  const conectados = localOrigem?.locais_conectados ?? [];
  if (!conectados.includes(destino)) {
    // Destino não conectado diretamente — verifica se existe alguma rota
    const todosLocais = getLocaisAtivos();
    const conectaveis = todosLocais.map(l => l.nome);
    if (!conectaveis.includes(destino)) {
      throw new Error(`Não há rota conhecida de "${origem}" para "${destino}".`);
    }
    // Permite viagem mesmo sem conexão direta — mais perigosa
  }

  // Verifica restrição de acesso
  if (localDestino.restrito) {
    const player = getPlayer(jogador_id);
    // Verificação básica — factionEngine valida reputação se disponível
    if (localDestino.requer_reputacao) {
      console.warn(`[LocationEngine] ${destino} requer reputação com ${localDestino.requer_reputacao}.`);
    }
  }

  // Calcula perigo da rota
  const rotaPerigo = localOrigem?.rota_perigo?.[destino] ?? localDestino.nivel_perigo;

  // Sorteia evento de viagem
  const evento = sortearEventoViagem(rotaPerigo);

  // Calcula tempo de chegada
  const tempoMs     = localDestino.tempo_viagem_min * 60_000;
  const tempoChegada = new Date(Date.now() + tempoMs);

  // Registra viagem no banco
  const result = db.prepare(`
    INSERT INTO viagens (jogador_id, origem, destino, status, evento_encontrado, tempo_chegada)
    VALUES (?, ?, ?, 'em_viagem', ?, ?)
  `).run(
    jogador_id,
    origem,
    destino,
    evento.id !== "nada" ? evento.descricao : null,
    tempoChegada.toISOString()
  );

  logWorldEvent("viagem", `Jogador ${jogador_id} partiu de "${origem}" para "${destino}"`, [jogador_id]);

  return {
    viagem_id:       result.lastInsertRowid,
    origem,
    destino,
    tempo_viagem_min: localDestino.tempo_viagem_min,
    tempo_chegada:   tempoChegada.toISOString(),
    nivel_perigo_rota: rotaPerigo,
    evento_encontrado: evento.id !== "nada" ? {
      id:        evento.id,
      descricao: evento.descricao,
      combate:   evento.combate,
    } : null,
    custo_viagem: localDestino.custo_viagem,
  };
}

/**
 * Finaliza uma viagem — atualiza posição do jogador.
 */
export function finalizarViagem(viagem_id, jogador_id) {
  const viagem = db.prepare("SELECT * FROM viagens WHERE id = ? AND jogador_id = ?")
    .get(viagem_id, jogador_id);

  if (!viagem) throw new Error("Viagem não encontrada.");
  if (viagem.status !== "em_viagem") throw new Error("Viagem já finalizada.");

  const agora = new Date();
  const chegada = new Date(viagem.tempo_chegada);

  if (agora < chegada) {
    const restante = Math.ceil((chegada - agora) / 60_000);
    throw new Error(`Ainda em viagem. Chega em ${restante} minuto(s).`);
  }

  // Atualiza viagem
  db.prepare("UPDATE viagens SET status = 'chegou' WHERE id = ?").run(viagem_id);

  // Atualiza posição
  setLocalJogador(jogador_id, viagem.destino);

  return {
    chegou_em: viagem.destino,
    evento: viagem.evento_encontrado,
  };
}

/**
 * Verifica viagens em andamento e finaliza as que já chegaram.
 * Chamado pelo ticker do servidor.
 */
export function processarViagensCompletas() {
  const agora = new Date().toISOString();
  const viagens = db.prepare(`
    SELECT * FROM viagens
    WHERE status = 'em_viagem' AND tempo_chegada <= ?
  `).all(agora);

  const finalizadas = [];
  for (const v of viagens) {
    try {
      db.prepare("UPDATE viagens SET status = 'chegou' WHERE id = ?").run(v.id);
      setLocalJogador(v.jogador_id, v.destino);
      finalizadas.push({ jogador_id: v.jogador_id, destino: v.destino });
    } catch (err) {
      console.warn(`[LocationEngine] Erro ao finalizar viagem ${v.id}: ${err.message}`);
    }
  }

  return finalizadas;
}

// ==========================================
// CONTEÚDO PRÓPRIO DO LOCAL
// ==========================================

/**
 * Retorna os NPCs presentes em um local (fixos + spawns ativos).
 */
export function getNPCsNoLocal(nome_local) {
  const local = getLocalByNome(nome_local);
  if (!local) return [];

  // NPCs fixos definidos no local
  const fixos = local.npcs_fixos;

  // NPCs dinâmicos (entidades vivas com status ativo neste local)
  const dinamicos = db.prepare(`
    SELECT nome_unico FROM entidades_vivas
    WHERE status NOT IN ('morto', 'fugiu') AND territorio = ?
  `).all(nome_local).map(e => e.nome_unico);

  return [...new Set([...fixos, ...dinamicos])];
}

/**
 * Retorna os itens encontráveis em um local com chance de drop.
 */
export function getItensNoLocal(nome_local) {
  const local = getLocalByNome(nome_local);
  if (!local) return [];

  const estado = getFullWorldState();

  return local.itens_locais.map(nome => ({
    nome,
    chance_encontrar: _calcularChanceEncontrar(nome, local, estado),
  }));
}

function _calcularChanceEncontrar(nome_item, local, estado) {
  let chance = 0.4; // 40% base

  // Locais mais perigosos têm itens melhores mas mais difíceis de achar
  chance -= local.nivel_perigo * 0.02;

  // Vácuo alto reduz chance de encontrar itens mágicos
  if (/artefato|runa|sigilo|grimório/i.test(nome_item) && estado.influencia_vacuo > 50) {
    chance *= 0.7;
  }

  // Irmandade forte torna itens de combate mais escassos
  if (/arma|veneno|granada/i.test(nome_item) && estado.poder_irmandade > 70) {
    chance *= 0.6;
  }

  return Math.max(0.05, Math.min(0.9, chance));
}

// ==========================================
// HISTÓRICO DE LOCAIS
// ==========================================

export function getHistoricoLocais(jogador_id, limit = 20) {
  return db.prepare(`
    SELECT * FROM historico_locais
    WHERE jogador_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(jogador_id, limit);
}

export function getLocaisDescobertos(jogador_id) {
  return db.prepare(`
    SELECT l.* FROM locais l
    JOIN historico_locais h ON l.nome = h.local_nome
    WHERE h.jogador_id = ? AND h.acao = 'chegou'
    GROUP BY l.nome
    ORDER BY l.nome
  `).all(jogador_id).map(_hydratarLocal);
}
// ==========================================
// LOCATION ENGINE — VEXON (PARTE 2 DE 2)
// Geração dinâmica de locais via IA, eventos de exploração e rotas
// ==========================================


// ==========================================
// GERAÇÃO DINÂMICA DE LOCAIS VIA IA
// ==========================================

/**
 * Gera um novo local completamente via IA.
 * Acontece quando o jogador explora além dos limites conhecidos
 * ou quando eventos do mundo criam novas localizações.
 *
 * @param {object} contexto
 *   - tipo_preferido: tipo do local
 *   - local_origem: de onde o jogador está vindo
 *   - faccao_contexto: facção que motivou a criação
 *   - descricao_breve: sugestão livre
 */
export async function gerarLocalDinamico(contexto = {}) {
  const {
    tipo_preferido = null,
    local_origem = "Cidade de Vexon — Centro",
    faccao_contexto = null,
    descricao_breve = null,
  } = contexto;

  const estado = getFullWorldState();
  const locaisExistentes = getLocaisAtivos().map(l => l.nome).join(", ");

  const prompt = `${TOM_VEXON}

Você é o criador de locais para o RPG Vexon. Gere UM local novo, coerente com o universo e que ainda não existe no mapa.

Estado do mundo:
- A Irmandade: ${estado.poder_irmandade}%
- Darvoss Dynamics: ${estado.poder_darvoss}%
- Quasiluz: ${estado.nivel_quasiluz}%
- Influência do Vácuo: ${estado.influencia_vacuo}%

Locais que já existem: ${locaisExistentes}
Local de origem do jogador: ${local_origem}
${tipo_preferido ? `Tipo preferido: ${tipo_preferido}` : ""}
${faccao_contexto ? `Facção que controla ou usa: ${faccao_contexto}` : ""}
${descricao_breve ? `Sugestão: ${descricao_breve}` : ""}

Gere um local ÚNICO que não seja similar aos existentes. JSON APENAS:
{
  "nome": "Nome único e evocativo",
  "tipo": "cidade|beco|dungeon|ruinas|laboratorio|base|exterior",
  "descricao": "2-3 frases descritivas imersivas",
  "descricao_curta": "1 frase resumo",
  "nivel_perigo": número de 1 a 10,
  "faccao_controle": "nome da facção ou null",
  "npcs_fixos": ["Nome NPC 1"],
  "itens_locais": ["Item 1", "Item 2"],
  "locais_conectados": ["${local_origem}"],
  "rota_perigo": { "${local_origem}": número },
  "tempo_viagem_min": número entre 5 e 120,
  "custo_viagem": número entre 0 e 200,
  "restrito": 0 ou 1
}`;

  try {
    const raw = await callOllamaWorld([
      { role: "system", content: "Você cria locais. Responda APENAS com JSON válido." },
      { role: "user",   content: prompt },
    ], { num_predict: 400, temperature: 0.85 });

    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON inválido.");

    const data = JSON.parse(match[0]);

    // Valida nome único
    const existente = getLocalByNome(data.nome);
    if (existente) throw new Error(`Local "${data.nome}" já existe.`);

    // Insere no banco
    const result = db.prepare(`
      INSERT INTO locais (
        nome, tipo, descricao, descricao_curta,
        nivel_perigo, faccao_controle,
        npcs_fixos, itens_locais,
        locais_conectados, rota_perigo,
        tempo_viagem_min, custo_viagem,
        restrito, criado_por_ia
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      data.nome, data.tipo, data.descricao, data.descricao_curta,
      Math.min(10, Math.max(1, data.nivel_perigo)),
      data.faccao_controle ?? null,
      toJson(data.npcs_fixos ?? []),
      toJson(data.itens_locais ?? []),
      toJson(data.locais_conectados ?? [local_origem]),
      toJson(data.rota_perigo ?? {}),
      Math.min(120, Math.max(5, data.tempo_viagem_min)),
      Math.max(0, data.custo_viagem ?? 0),
      data.restrito ?? 0
    );

    // Adiciona este local como conexão de volta na origem
    const localOrigem = getLocalByNome(local_origem);
    if (localOrigem) {
      const novasConexoes = [...localOrigem.locais_conectados, data.nome];
      const novoRota = { ...localOrigem.rota_perigo, [data.nome]: data.nivel_perigo };
      db.prepare(`
        UPDATE locais
        SET locais_conectados = ?, rota_perigo = ?
        WHERE nome = ?
      `).run(toJson(novasConexoes), toJson(novoRota), local_origem);
    }

    logWorldEvent("local_criado", `[IA] Novo local: "${data.nome}" (${data.tipo})`, []);
    console.log(`[LocationEngine] Local gerado pela IA: "${data.nome}"`);

    return {
      local_id: result.lastInsertRowid,
      nome: data.nome,
      tipo: data.tipo,
      nivel_perigo: data.nivel_perigo,
      novo: true,
    };
  } catch (err) {
    console.error("[LocationEngine] Geração de local falhou:", err.message);
    return null;
  }
}

// ==========================================
// NARRAÇÃO DE CHEGADA (via IA)
// ==========================================

/**
 * Gera narração imersiva ao chegar em um local.
 * Considera o estado do mundo e o histórico do jogador.
 */
export async function narrarChegada(jogador_id, nome_local) {
  const local  = getLocalByNome(nome_local);
  const player = getPlayer(jogador_id);
  const estado = getFullWorldState();

  if (!local) return `Você chega em ${nome_local}.`;

  const npcsPresentes = getNPCsNoLocal(nome_local);
  const jaPrimeiraVez = !db.prepare(`
    SELECT 1 FROM historico_locais
    WHERE jogador_id = ? AND local_nome = ? AND acao = 'chegou'
    LIMIT 1
  `).get(jogador_id, nome_local);

  const prompt = `${TOM_VEXON}

Narre a chegada do personagem ao local em 1-2 parágrafos, segunda pessoa, visceral e imersivo.

Local: ${local.nome} (${local.tipo})
Descrição: ${local.descricao}
Perigo: ${local.nivel_perigo}/10
Facção presente: ${local.faccao_controle ?? "Nenhuma"}
NPCs visíveis: ${npcsPresentes.length > 0 ? npcsPresentes.join(", ") : "Nenhum"}
${jaPrimeiraVez ? "PRIMEIRA VEZ que o jogador visita este local." : "O jogador já conhece este local."}

Estado do mundo relevante:
- Quasiluz: ${estado.nivel_quasiluz}% (${estado.nivel_quasiluz > 50 ? "alta — névoa mental possível" : "controlada"})
- Influência do Vácuo: ${estado.influencia_vacuo}%`;

  try {
    return await callOllamaWorld([
      { role: "system", content: "Você narra chegadas. Máximo 2 parágrafos. Sem quebrar imersão." },
      { role: "user",   content: prompt },
    ], { num_predict: 200, temperature: 0.82 });
  } catch {
    return `${jaPrimeiraVez ? "Você entra pela primeira vez em" : "Você retorna a"} ${local.nome}. ${local.descricao_curta}`;
  }
}

// ==========================================
// NARRAÇÃO DE EVENTO DE VIAGEM (via IA)
// ==========================================

/**
 * Gera narração para um evento encontrado durante a viagem.
 */
export async function narrarEventoViagem(evento, origem, destino, player) {
  if (!evento) return null;

  const prompt = `Narre este evento de viagem em 2-3 frases, segunda pessoa, tom sombrio Vexon.

Viagem: de "${origem}" para "${destino}"
Evento: ${evento.descricao}
Combate envolvido: ${evento.combate ? "Sim" : "Não"}
Jogador: ${player.nome} (Nível ${player.nivel})`;

  try {
    return await callOllamaWorld([
      { role: "system", content: "Narre eventos de viagem. Máximo 3 frases." },
      { role: "user",   content: prompt },
    ], { num_predict: 120, temperature: 0.8 });
  } catch {
    return evento.descricao;
  }
}

// ==========================================
// EXPLORAÇÃO DO LOCAL
// ==========================================

/**
 * O jogador explora o local atual — pode encontrar itens, NPCs secretos,
 * ou criar um sub-local novo via IA.
 *
 * @param {number} jogador_id
 * @param {boolean} explorar_fundo - Se true, tenta gerar sub-local via IA
 */
export async function explorarLocal(jogador_id, explorar_fundo = false) {
  const posicao = getPosicaoJogador(jogador_id);
  const local   = getLocalByNome(posicao.local_atual);
  const player  = getPlayer(jogador_id);

  if (!local) throw new Error("Local atual não encontrado.");

  // Registra exploração
  db.prepare(`
    INSERT INTO historico_locais (jogador_id, local_nome, acao, descricao)
    VALUES (?, ?, 'explorou', ?)
  `).run(jogador_id, local.nome, `${player.nome} explorou ${local.nome}`);

  const resultados = {
    local: local.nome,
    npcs_encontrados: [],
    itens_possiveis:  [],
    novo_local:       null,
    narrativa:        null,
  };

  // NPCs presentes
  resultados.npcs_encontrados = getNPCsNoLocal(local.nome);

  // Itens possíveis com chances
  const itens = getItensNoLocal(local.nome);
  resultados.itens_possiveis = itens.filter(i => Math.random() < i.chance_encontrar);

  // Exploração profunda — gera sub-local via IA
  if (explorar_fundo && local.nivel_perigo >= 5) {
    const novoLocal = await gerarLocalDinamico({
      local_origem:    local.nome,
      tipo_preferido:  local.tipo === "dungeon" ? "dungeon" : "beco",
      faccao_contexto: local.faccao_controle,
      descricao_breve: `Sub-área de ${local.nome}, mais profunda e perigosa`,
    });

    if (novoLocal) {
      resultados.novo_local = novoLocal;
      logWorldEvent("exploracao", `Jogador ${jogador_id} descobriu "${novoLocal.nome}" em ${local.nome}`, [jogador_id]);
    }
  }

  // Gera narrativa
  resultados.narrativa = await _gerarNarrativaExploracao(local, resultados, player);

  return resultados;
}

async function _gerarNarrativaExploracao(local, resultados, player) {
  const itensEncontrados = resultados.itens_possiveis.map(i => i.nome).join(", ");
  const npcsVisiveis     = resultados.npcs_encontrados.join(", ");
  const novoLocal        = resultados.novo_local?.nome;

  const prompt = `Narre a exploração do local em 1-2 frases, segunda pessoa, tom Vexon.

Local: ${local.nome} (perigo ${local.nivel_perigo}/10)
Itens encontrados: ${itensEncontrados || "Nenhum"}
NPCs visíveis: ${npcsVisiveis || "Nenhum"}
${novoLocal ? `Nova área descoberta: ${novoLocal}` : ""}`;

  try {
    return await callOllamaWorld([
      { role: "system", content: "Narre explorações. Máximo 2 frases." },
      { role: "user",   content: prompt },
    ], { num_predict: 100, temperature: 0.8 });
  } catch {
    return `Você vasculha ${local.nome}. ${itensEncontrados ? `Encontra: ${itensEncontrados}.` : "Nada útil desta vez."}`;
  }
}

// ==========================================
// TICKER DE VIAGENS
// ==========================================

let _locationTicker = null;

export function iniciarLocationTicker() {
  if (_locationTicker) return;

  const intervalo = (Number(process.env.LOCATION_TICK_SEGUNDOS) || 30) * 1000;
  console.log(`[LocationEngine] Ticker iniciado — intervalo: ${intervalo / 1000}s`);

  _locationTicker = setInterval(() => {
    try {
      const finalizadas = processarViagensCompletas();
      if (finalizadas.length > 0) {
        console.log(`[LocationEngine] ${finalizadas.length} viagem(ns) finalizada(s).`);
      }
    } catch (err) {
      console.error("[LocationEngine] Erro no ticker:", err.message);
    }
  }, intervalo);
}

export function pararLocationTicker() {
  if (_locationTicker) {
    clearInterval(_locationTicker);
    _locationTicker = null;
    console.log("[LocationEngine] Ticker parado.");
  }
}

// ==========================================
// ROTAS HTTP
// ==========================================

export function setupLocationRoutes(app) {
  // GET - Local atual do jogador
  app.get("/api/location/atual/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const posicao = getPosicaoJogador(jogador_id);
      const local   = getLocalByNome(posicao.local_atual);
      const npcs    = getNPCsNoLocal(posicao.local_atual);
      const conexoes = getLocaisConectados(posicao.local_atual);

      res.json({ sucesso: true, posicao, local, npcs_presentes: npcs, conexoes_disponiveis: conexoes });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Todos os locais conhecidos
  app.get("/api/location/mapa", (_req, res) => {
    try {
      const locais = getLocaisAtivos();
      res.json({ sucesso: true, locais });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Locais descobertos pelo jogador
  app.get("/api/location/descobertos/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const locais = getLocaisDescobertos(jogador_id);
      res.json({ sucesso: true, locais });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Iniciar viagem
  app.post("/api/location/viajar", async (req, res) => {
    const { jogador_id, destino, narrar = true } = req.body;
    if (!jogador_id || !destino) {
      return res.status(400).json({ sucesso: false, erro: "jogador_id e destino obrigatórios." });
    }
    try {
      const viagem  = iniciarViagem(jogador_id, destino);
      const player  = getPlayer(jogador_id);
      let narrativa = null;

      if (narrar && viagem.evento_encontrado) {
        const posicao = getPosicaoJogador(jogador_id);
        narrativa = await narrarEventoViagem(
          viagem.evento_encontrado,
          posicao.local_atual,
          destino,
          player
        );
      }

      res.json({ sucesso: true, viagem, narrativa });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Finalizar viagem (chegar ao destino)
  app.post("/api/location/chegar/:viagem_id", async (req, res) => {
    const viagem_id  = Number(req.params.viagem_id);
    const { jogador_id, narrar = true } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });

    try {
      const resultado = finalizarViagem(viagem_id, jogador_id);
      let narrativa   = null;

      if (narrar) {
        narrativa = await narrarChegada(jogador_id, resultado.chegou_em);
      }

      res.json({ sucesso: true, ...resultado, narrativa });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Explorar local atual
  app.post("/api/location/explorar/:jogador_id", async (req, res) => {
    const jogador_id    = Number(req.params.jogador_id);
    const { fundo = false } = req.body;
    try {
      const resultado = await explorarLocal(jogador_id, fundo);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Gerar local dinâmico via IA
  app.post("/api/location/gerar", async (req, res) => {
    const { tipo_preferido, local_origem, faccao_contexto, descricao_breve } = req.body;
    try {
      const novoLocal = await gerarLocalDinamico({ tipo_preferido, local_origem, faccao_contexto, descricao_breve });
      if (!novoLocal) return res.status(500).json({ sucesso: false, erro: "Falha na geração." });
      res.json({ sucesso: true, local: novoLocal });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Detalhes de um local específico
  app.get("/api/location/:nome", (req, res) => {
    const nome = decodeURIComponent(req.params.nome);
    try {
      const local = getLocalByNome(nome);
      if (!local) return res.status(404).json({ sucesso: false, erro: "Local não encontrado." });

      const npcs    = getNPCsNoLocal(nome);
      const itens   = getItensNoLocal(nome);
      const conexoes = getLocaisConectados(nome);

      res.json({ sucesso: true, local, npcs_presentes: npcs, itens_possiveis: itens, conexoes });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Histórico de viagens do jogador
  app.get("/api/location/historico/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    try {
      const historico = getHistoricoLocais(jogador_id, limit);
      res.json({ sucesso: true, historico });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[LocationEngine] Rotas registradas: /api/location/*");
}