import Database from 'better-sqlite3';

const db = new Database('vexon.db', { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined });

// ==========================================
// CONFIGURAÇÕES GLOBAIS
// ==========================================

// Tabela de XP para level-up (índice = nível atual, valor = XP necessário para subir)
const XP_TABLE = [
  0,    // nível 0 → 1
  1000, // nível 1 → 2
  2500, // nível 2 → 3
  4500, // nível 3 → 4
  7000, // nível 4 → 5
  10000,// nível 5 → 6
  14000,// nível 6 → 7
  19000,// nível 7 → 8
  25000,// nível 8 → 9
  32000,// nível 9 → 10
];

// Bônus concedidos por level-up (pode ser expandido com habilidades, etc.)
const LEVEL_UP_BONUS = {
  hp: 10,
  getXpNecessario: (nivel) => XP_TABLE[nivel] ?? nivel * 1500,
};

// ==========================================
// HELPERS DE SERIALIZAÇÃO JSON
// ==========================================

/**
 * Faz parse seguro de um campo JSON guardado como TEXT.
 * Retorna o fallback se o valor for nulo, vazio ou inválido.
 */
export function parseJson(str, fallback = []) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Serializa um valor para JSON string.
 * Garante que arrays/objetos sejam guardados corretamente.
 */
export function toJson(value) {
  if (typeof value === 'string') return value; // já serializado
  return JSON.stringify(value ?? []);
}

/**
 * Desserializa os campos JSON de uma entidade (memória, aliados, inimigos, etc.).
 * Retorna a entidade com os campos já parseados.
 */
function hydrateJsonFields(entity, fields = ['memoria', 'inimigos', 'aliados', 'habilidades', 'acoes']) {
  if (!entity) return null;
  const result = { ...entity };
  for (const field of fields) {
    if (field in result) result[field] = parseJson(result[field]);
  }
  return result;
}

// ==========================================
// CONFIGURAÇÕES DO BANCO (WAL MODE + FOREIGN KEYS)
// ==========================================

// WAL mode: muito mais rápido para leitura/escrita simultânea
db.pragma('journal_mode = WAL');

// Garante integridade referencial nas foreign keys
db.pragma('foreign_keys = ON');

// ==========================================
// CRIAÇÃO DAS TABELAS
// ==========================================

db.exec(`
  -- ==========================================
  -- COMPÊNDIO
  -- ==========================================

  CREATE TABLE IF NOT EXISTS npcs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                TEXT NOT NULL,
    classe              TEXT DEFAULT NULL,
    tamanho             TEXT,
    tipo                TEXT,
    alinhamento         TEXT,
    nivel_social        TEXT,
    arquetipo           TEXT,
    deslocamento        TEXT,
    ca                  INTEGER DEFAULT 10,
    hp                  INTEGER DEFAULT 10,
    forca               INTEGER DEFAULT 10,
    destreza            INTEGER DEFAULT 10,
    resistencia         INTEGER DEFAULT 10,
    inteligencia        INTEGER DEFAULT 10,
    sabedoria           INTEGER DEFAULT 10,
    carisma             INTEGER DEFAULT 10,
    ouro                INTEGER DEFAULT 0,
    memoria             TEXT DEFAULT '[]',
    relacao_com_jogador TEXT DEFAULT 'Desconhecido',
    objetivo            TEXT DEFAULT 'Sobreviver',
    faccao              TEXT DEFAULT 'Nenhuma',
    inimigos            TEXT DEFAULT '[]',
    aliados             TEXT DEFAULT '[]',
    territorio          TEXT DEFAULT 'Desconhecido',
    nivel               INTEGER DEFAULT 1,
    idiomas             TEXT,
    habilidades_passivas TEXT,
    acoes               TEXT,
    personalidade       TEXT,
    descricao           TEXT,
    influencia          INTEGER DEFAULT 0,
    tendencia           TEXT,
    criado_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS itens (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                TEXT NOT NULL,
    tipo                TEXT,
    raridade            TEXT DEFAULT 'comum',
    dano_ou_efeito      TEXT,
    propriedades        TEXT,
    peso                TEXT,
    valor               TEXT,
    descricao           TEXT,
    habilidade_tematica TEXT,
    criado_em           DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS monstros (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                TEXT NOT NULL,
    classe              TEXT DEFAULT NULL,
    tamanho             TEXT,
    tipo                TEXT,
    alinhamento         TEXT,
    deslocamento        TEXT,
    nome_unico          TEXT,
    hp_maximo           INTEGER DEFAULT 10,
    hp_atual            INTEGER DEFAULT 10,
    ca                  INTEGER DEFAULT 10,
    forca               INTEGER DEFAULT 10,
    destreza            INTEGER DEFAULT 10,
    resistencia         INTEGER DEFAULT 10,
    inteligencia        INTEGER DEFAULT 10,
    sabedoria           INTEGER DEFAULT 10,
    carisma             INTEGER DEFAULT 10,
    ouro                INTEGER DEFAULT 0,
    memoria             TEXT DEFAULT '[]',
    relacao_com_jogador TEXT DEFAULT 'Agressivo',
    objetivo            TEXT DEFAULT 'Caçar/Proteger território',
    faccao              TEXT DEFAULT 'Nenhuma',
    inimigos            TEXT DEFAULT '[]',
    aliados             TEXT DEFAULT '[]',
    territorio          TEXT DEFAULT 'Desconhecido',
    habilidades_passivas TEXT,
    acoes               TEXT,
    descricao           TEXT,
    ameaca              TEXT,
    nivel               INTEGER DEFAULT 1,
    criado_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==========================================
  -- JOGADOR E INVENTÁRIO
  -- ==========================================

  CREATE TABLE IF NOT EXISTS jogadores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT NOT NULL,
    classe          TEXT DEFAULT NULL,
    idade           INTEGER DEFAULT NULL,
    genero          TEXT DEFAULT NULL,
    aparencia_fisica TEXT DEFAULT '',
    personalidade   TEXT DEFAULT '',
    background      TEXT DEFAULT '',
    status          TEXT DEFAULT 'ativo',
    dados_vida_gastos    INTEGER DEFAULT 0,
    ultimo_descanso_longo INTEGER DEFAULT NULL,
    death_save_sucessos  INTEGER DEFAULT 0,
    death_save_falhas    INTEGER DEFAULT 0,
    deslocamento    TEXT DEFAULT '9m',
    nivel           INTEGER DEFAULT 1,
    xp              INTEGER DEFAULT 0,
    xp_necessario   INTEGER DEFAULT 1000,
    habilidades     TEXT DEFAULT '[]',
    hp_maximo       INTEGER DEFAULT 10,
    hp_atual        INTEGER DEFAULT 10,
    ca              INTEGER DEFAULT 10,
    forca           INTEGER DEFAULT 10,
    destreza        INTEGER DEFAULT 10,
    resistencia     INTEGER DEFAULT 10,
    inteligencia    INTEGER DEFAULT 10,
    sabedoria       INTEGER DEFAULT 10,
    carisma         INTEGER DEFAULT 10,
    ouro            INTEGER DEFAULT 0,
    objetivo        TEXT DEFAULT '',
    faccao          TEXT DEFAULT '',
    inimigos        TEXT DEFAULT '[]',
    aliados         TEXT DEFAULT '[]',
    territorio      TEXT DEFAULT '',
    criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inventario (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id  INTEGER NOT NULL,
    item_id     INTEGER NOT NULL,
    quantidade  INTEGER DEFAULT 1,
    equipado    INTEGER DEFAULT 0,
    FOREIGN KEY(jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id)    REFERENCES itens(id)     ON DELETE CASCADE,
    UNIQUE(jogador_id, item_id)
  );

  -- ==========================================
  -- MUNDO VIVO E SISTEMA NEMESIS
  -- ==========================================

  CREATE TABLE IF NOT EXISTS entidades_vivas (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_entidade           TEXT NOT NULL CHECK(tipo_entidade IN ('npc','monstro')),
    template_id             INTEGER,
    nome_unico              TEXT,
    hp_maximo               INTEGER DEFAULT 10,
    hp_atual                INTEGER DEFAULT 10,
    ca                      INTEGER DEFAULT 10,
    forca                   INTEGER DEFAULT 10,
    destreza                INTEGER DEFAULT 10,
    resistencia             INTEGER DEFAULT 10,
    inteligencia            INTEGER DEFAULT 10,
    sabedoria               INTEGER DEFAULT 10,
    carisma                 INTEGER DEFAULT 10,
    nivel                   INTEGER DEFAULT 1,
    ouro                    INTEGER DEFAULT 0,
    memoria                 TEXT DEFAULT '[]',
    relacao_com_jogador     TEXT DEFAULT 'Desconhecido',
    objetivo                TEXT DEFAULT '',
    faccao                  TEXT DEFAULT '',
    inimigos                TEXT DEFAULT '[]',
    aliados                 TEXT DEFAULT '[]',
    territorio              TEXT DEFAULT '',
    bonus_ca                INTEGER DEFAULT 0,
    bonus_dano              INTEGER DEFAULT 0,
    historico_consequencias TEXT DEFAULT '',
    nova_personalidade      TEXT DEFAULT '',
    status                  TEXT DEFAULT 'vivo' CHECK(status IN ('vivo','morto','fugiu','inconsciente')),
    localizacao_id          INTEGER,
    criado_em               DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(localizacao_id) REFERENCES localizacoes(id)
  );

  -- ==========================================
  -- SESSÕES DO RPG MASTER (MEMÓRIA DO OLLAMA)
  -- ==========================================

  CREATE TABLE IF NOT EXISTS sessoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id  INTEGER NOT NULL,
    titulo      TEXT DEFAULT 'Nova Sessão',
    mensagens   TEXT DEFAULT '[]',  -- array de {role: 'user'|'assistant', content: '...'}
    ativa       INTEGER DEFAULT 1,
    criada_em   DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
  );

  -- ==========================================
  -- LOG DE EVENTOS DO MUNDO VIVO
  -- ==========================================

  CREATE TABLE IF NOT EXISTS eventos_mundo (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo        TEXT NOT NULL,  -- 'morte', 'aliança', 'batalha', 'level_up', 'descoberta', etc.
    descricao   TEXT,
    entidades   TEXT DEFAULT '[]',  -- IDs das entidades envolvidas
    localizacao TEXT,
    criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==========================================
  -- LOCALIZAÇÕES DO MUNDO
  -- ==========================================

  CREATE TABLE IF NOT EXISTS localizacoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL,
    tipo        TEXT,  -- 'cidade', 'dungeon', 'floresta', 'taverna', etc.
    descricao   TEXT,
    locais_conectados TEXT DEFAULT '[]',  -- IDs de localizações adjacentes
    npcs_fixos  TEXT DEFAULT '[]',
    itens_locais TEXT DEFAULT '[]',
    perigo      INTEGER DEFAULT 0,  -- 0-10
    criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ==========================================
  -- ÍNDICES DE PERFORMANCE
  -- ==========================================

  CREATE INDEX IF NOT EXISTS idx_npcs_nome        ON npcs(nome);
  CREATE INDEX IF NOT EXISTS idx_npcs_faccao      ON npcs(faccao);
  CREATE INDEX IF NOT EXISTS idx_monstros_nome    ON monstros(nome);
  CREATE INDEX IF NOT EXISTS idx_monstros_nivel   ON monstros(nivel);
  CREATE INDEX IF NOT EXISTS idx_itens_nome       ON itens(nome);
  CREATE INDEX IF NOT EXISTS idx_itens_tipo       ON itens(tipo);
  CREATE INDEX IF NOT EXISTS idx_inventario_jogador ON inventario(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_entidades_status ON entidades_vivas(status);
  CREATE INDEX IF NOT EXISTS idx_entidades_nome   ON entidades_vivas(nome_unico);
  CREATE INDEX IF NOT EXISTS idx_entidades_faccao ON entidades_vivas(faccao);
  CREATE INDEX IF NOT EXISTS idx_sessoes_jogador  ON sessoes(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_eventos_tipo     ON eventos_mundo(tipo);
  CREATE INDEX IF NOT EXISTS idx_eventos_criado   ON eventos_mundo(criado_em);
`);

// ==========================================
// MIGRAÇÕES — SQLite não suporta "ADD COLUMN IF NOT EXISTS",
// então cada ALTER roda isolado e ignora erro de coluna duplicada.
// ==========================================

function addColumnIfMissing(tabela, coluna, definicao) {
  try {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao};`);
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}

addColumnIfMissing('entidades_vivas', 'nivel', 'INTEGER DEFAULT 1');
addColumnIfMissing('jogadores', 'classe', 'TEXT DEFAULT NULL');
addColumnIfMissing('npcs', 'classe', 'TEXT DEFAULT NULL');
addColumnIfMissing('monstros', 'classe', 'TEXT DEFAULT NULL');
addColumnIfMissing('jogadores', 'idade', 'INTEGER DEFAULT NULL');
addColumnIfMissing('jogadores', 'genero', 'TEXT DEFAULT NULL');
addColumnIfMissing('jogadores', 'aparencia_fisica', "TEXT DEFAULT ''");
addColumnIfMissing('jogadores', 'personalidade', "TEXT DEFAULT ''");
addColumnIfMissing('jogadores', 'background', "TEXT DEFAULT ''");
// status da ficha: 'ativo' | 'inconsciente' (rolando teste contra a morte) | 'estavel' (3 sucessos, parou de rolar) | 'morto'
addColumnIfMissing('jogadores', 'status', "TEXT DEFAULT 'ativo'");
addColumnIfMissing('jogadores', 'dados_vida_gastos', 'INTEGER DEFAULT 0');
addColumnIfMissing('jogadores', 'ultimo_descanso_longo', 'INTEGER DEFAULT NULL');
addColumnIfMissing('jogadores', 'death_save_sucessos', 'INTEGER DEFAULT 0');
addColumnIfMissing('jogadores', 'death_save_falhas', 'INTEGER DEFAULT 0');

// ==========================================
// COMPÊNDIO — NPCs
// ==========================================

export function insertNpc(npc) {
  const stmt = db.prepare(`
    INSERT INTO npcs (
      nome, classe, tamanho, tipo, alinhamento, nivel_social, arquetipo, deslocamento,
      ca, hp, forca, destreza, resistencia, inteligencia, sabedoria, carisma, ouro,
      memoria, relacao_com_jogador, objetivo, faccao, inimigos, aliados, territorio,
      nivel, idiomas, habilidades_passivas, acoes, personalidade, descricao, influencia, tendencia
    ) VALUES (
      @nome, @classe, @tamanho, @tipo, @alinhamento, @nivel_social, @arquetipo, @deslocamento,
      @ca, @hp, @forca, @destreza, @resistencia, @inteligencia, @sabedoria, @carisma, @ouro,
      @memoria, @relacao_com_jogador, @objetivo, @faccao, @inimigos, @aliados, @territorio,
      @nivel, @idiomas, @habilidades_passivas, @acoes, @personalidade, @descricao, @influencia, @tendencia
    )
  `);
  return stmt.run({
    ...npc,
    classe:   npc.classe ?? null,
    memoria:  toJson(npc.memoria),
    inimigos: toJson(npc.inimigos),
    aliados:  toJson(npc.aliados),
  });
}

export function getNpcByName(nome) {
  const stmt = db.prepare('SELECT * FROM npcs WHERE nome LIKE ? LIMIT 1');
  return hydrateJsonFields(stmt.get(`%${nome}%`));
}

export function getAllNpcs() {
  return db.prepare('SELECT * FROM npcs ORDER BY nome').all().map(e => hydrateJsonFields(e));
}

export function updateNpcMemory(id, novaMemoria) {
  return db.prepare('UPDATE npcs SET memoria = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(toJson(novaMemoria), id);
}

// ==========================================
// COMPÊNDIO — ITENS
// ==========================================

export function insertItem(item) {
  const stmt = db.prepare(`
    INSERT INTO itens (nome, tipo, raridade, dano_ou_efeito, propriedades, peso, valor, descricao, habilidade_tematica)
    VALUES (@nome, @tipo, @raridade, @dano_ou_efeito, @propriedades, @peso, @valor, @descricao, @habilidade_tematica)
  `);
  return stmt.run(item);
}

export function getItemByName(nome) {
  return db.prepare('SELECT * FROM itens WHERE nome LIKE ? LIMIT 1').get(`%${nome}%`);
}

export function getItemsByType(tipo) {
  return db.prepare('SELECT * FROM itens WHERE tipo = ?').all(tipo);
}

// ==========================================
// COMPÊNDIO — MONSTROS
// ==========================================

export function insertMonster(monster) {
  const stmt = db.prepare(`
    INSERT INTO monstros (
      nome, classe, tamanho, tipo, alinhamento, deslocamento, nome_unico,
      hp_maximo, hp_atual, ca, forca, destreza, resistencia, inteligencia, sabedoria, carisma, ouro,
      memoria, relacao_com_jogador, objetivo, faccao, inimigos, aliados, territorio,
      habilidades_passivas, acoes, descricao, ameaca, nivel
    ) VALUES (
      @nome, @classe, @tamanho, @tipo, @alinhamento, @deslocamento, @nome_unico,
      @hp_maximo, @hp_atual, @ca, @forca, @destreza, @resistencia, @inteligencia, @sabedoria, @carisma, @ouro,
      @memoria, @relacao_com_jogador, @objetivo, @faccao, @inimigos, @aliados, @territorio,
      @habilidades_passivas, @acoes, @descricao, @ameaca, @nivel
    )
  `);
  return stmt.run({
    ...monster,
    classe:     monster.classe ?? null,
    nome_unico: monster.nome_unico ?? monster.nome,
    memoria:  toJson(monster.memoria),
    inimigos: toJson(monster.inimigos),
    aliados:  toJson(monster.aliados),
  });
}

export function getMonsterByName(nome) {
  const stmt = db.prepare('SELECT * FROM monstros WHERE nome LIKE ? LIMIT 1');
  return hydrateJsonFields(stmt.get(`%${nome}%`));
}

export function getMonstersByLevel(nivelMin, nivelMax) {
  return db.prepare('SELECT * FROM monstros WHERE nivel BETWEEN ? AND ? ORDER BY nivel')
    .all(nivelMin, nivelMax)
    .map(e => hydrateJsonFields(e));
}

// ==========================================
// JOGADOR
// ==========================================

export function insertPlayer(player) {
  const stmt = db.prepare(`
    INSERT INTO jogadores (
      nome, classe, idade, genero, aparencia_fisica, personalidade, background,
      nivel, xp, hp_maximo, hp_atual, ca,
      forca, destreza, resistencia, inteligencia, sabedoria, carisma, ouro,
      objetivo, faccao, inimigos, aliados, territorio
    ) VALUES (
      @nome, @classe, @idade, @genero, @aparencia_fisica, @personalidade, @background,
      @nivel, @xp, @hp_maximo, @hp_atual, @ca,
      @forca, @destreza, @resistencia, @inteligencia, @sabedoria, @carisma, @ouro,
      @objetivo, @faccao, @inimigos, @aliados, @territorio
    )
  `);
  return stmt.run({
    ...player,
    classe:           player.classe ?? null,
    idade:            player.idade ?? null,
    genero:           player.genero ?? null,
    aparencia_fisica: player.aparencia_fisica ?? '',
    personalidade:    player.personalidade ?? '',
    background:       player.background ?? '',
    inimigos:         toJson(player.inimigos),
    aliados:          toJson(player.aliados),
  });
}

export function getPlayer(id) {
  const player = db.prepare('SELECT * FROM jogadores WHERE id = ?').get(id);
  return hydrateJsonFields(player, ['habilidades', 'inimigos', 'aliados']);
}

export function getAllPlayers() {
  return db.prepare('SELECT id, nome, classe, nivel, hp_atual, hp_maximo, ouro FROM jogadores ORDER BY id DESC').all();
}

export function updatePlayerHP(id, novoHp) {
  const player = db.prepare('SELECT hp_maximo FROM jogadores WHERE id = ?').get(id);
  if (!player) return null;
  const hpFinal = Math.max(0, Math.min(novoHp, player.hp_maximo));
  return db.prepare('UPDATE jogadores SET hp_atual = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hpFinal, id);
}

export function addPlayerGold(id, gold) {
  return db.prepare('UPDATE jogadores SET ouro = MAX(0, ouro + ?), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(gold, id);
}

/**
 * Status da ficha do jogador: 'ativo' | 'inconsciente' | 'estavel' | 'morto'.
 * Ver Readme.txt, seção "Caindo a 0 Pontos de Vida".
 */
export function updatePlayerStatus(id, status) {
  return db.prepare('UPDATE jogadores SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, id);
}

/**
 * Registra o gasto de N Dados de Vida num Descanso Curto (soma ao total já gasto).
 */
export function gastarDadosDeVida(id, quantidade) {
  return db.prepare('UPDATE jogadores SET dados_vida_gastos = dados_vida_gastos + ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(quantidade, id);
}

/**
 * Zera os Dados de Vida gastos — chamado ao final de um Descanso Longo bem-sucedido.
 */
export function resetDadosDeVida(id) {
  return db.prepare('UPDATE jogadores SET dados_vida_gastos = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(id);
}

/**
 * Grava o timestamp (epoch ms) do último Descanso Longo bem-sucedido — usado para
 * bloquear um segundo Descanso Longo antes de 24h reais terem se passado.
 */
export function registrarDescansoLongo(id, timestampMs) {
  return db.prepare('UPDATE jogadores SET ultimo_descanso_longo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
    .run(timestampMs, id);
}

/**
 * Grava o resultado de um teste contra a morte: contagem de sucessos/falhas,
 * o novo status da ficha e, opcionalmente, um novo HP (usado no 20 natural).
 */
export function registrarDeathSave(id, { sucessos, falhas, status, hp = null }) {
  if (hp !== null) {
    return db.prepare(`
      UPDATE jogadores
      SET death_save_sucessos = ?, death_save_falhas = ?, status = ?, hp_atual = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sucessos, falhas, status, hp, id);
  }
  return db.prepare(`
    UPDATE jogadores
    SET death_save_sucessos = ?, death_save_falhas = ?, status = ?, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sucessos, falhas, status, id);
}

/**
 * Concede XP ao jogador e processa level-up automaticamente.
 * Retorna { xpTotal, subiuDeNivel, novoNivel, hpMaximo, niveisSobidos }
 */
export function awardPlayerXP(jogador_id, xpGanho) {
  const player = getPlayer(jogador_id);
  if (!player) return null;

  let novoXp     = player.xp + xpGanho;
  let novoNivel  = player.nivel;
  let hpMaximo   = player.hp_maximo;
  let niveisSobidos = 0;

  // Processa múltiplos level-ups de uma vez
  let xpNecessario = LEVEL_UP_BONUS.getXpNecessario(novoNivel);
  while (novoXp >= xpNecessario) {
    novoXp      -= xpNecessario;
    novoNivel   += 1;
    hpMaximo    += LEVEL_UP_BONUS.hp;
    niveisSobidos++;
    xpNecessario = LEVEL_UP_BONUS.getXpNecessario(novoNivel);
  }

  const subiuDeNivel = niveisSobidos > 0;
  // Se subiu de nível, restaura HP completamente; senão mantém o HP atual
  const hpAtual = subiuDeNivel ? hpMaximo : player.hp_atual;

  db.prepare(`
    UPDATE jogadores
    SET xp = ?, nivel = ?, xp_necessario = ?, hp_maximo = ?, hp_atual = ?, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(novoXp, novoNivel, xpNecessario, hpMaximo, hpAtual, jogador_id);

  if (subiuDeNivel) {
    logWorldEvent('level_up', `${player.nome} subiu para o nível ${novoNivel}!`, [jogador_id]);
  }

  return { xpTotal: novoXp, subiuDeNivel, novoNivel, hpMaximo, niveisSobidos };
}

// ==========================================
// INVENTÁRIO
// ==========================================

/**
 * Adiciona item ao inventário. Se já existir, incrementa a quantidade.
 */
export function addItemToInventory(jogador_id, item_id, quantidade = 1) {
  return db.prepare(`
    INSERT INTO inventario (jogador_id, item_id, quantidade)
    VALUES (?, ?, ?)
    ON CONFLICT(jogador_id, item_id) DO UPDATE SET quantidade = quantidade + excluded.quantidade
  `).run(jogador_id, item_id, quantidade);
}

export function getPlayerInventory(jogador_id) {
  return db.prepare(`
    SELECT inv.id AS inventario_id, inv.quantidade, inv.equipado, itens.*
    FROM inventario inv
    JOIN itens ON inv.item_id = itens.id
    WHERE inv.jogador_id = ?
    ORDER BY itens.tipo, itens.nome
  `).all(jogador_id);
}

export function getEquippedWeapon(jogador_id) {
  return db.prepare(`
    SELECT itens.*
    FROM inventario inv
    JOIN itens ON inv.item_id = itens.id
    WHERE inv.jogador_id = ? AND inv.equipado = 1 AND itens.tipo = 'arma'
    LIMIT 1
  `).get(jogador_id);
}

/**
 * Equipa uma arma (desequipa as outras) — operação atômica via transação.
 */
export const equipWeapon = db.transaction((jogador_id, inventario_id) => {
  // Valida que o item pertence ao jogador e é uma arma
  const item = db.prepare(`
    SELECT inv.id FROM inventario inv
    JOIN itens ON inv.item_id = itens.id
    WHERE inv.id = ? AND inv.jogador_id = ? AND itens.tipo = 'arma'
  `).get(inventario_id, jogador_id);

  if (!item) throw new Error('Item não encontrado ou não é uma arma.');

  db.prepare(`
    UPDATE inventario SET equipado = 0
    WHERE jogador_id = ? AND item_id IN (SELECT id FROM itens WHERE tipo = 'arma')
  `).run(jogador_id);

  return db.prepare('UPDATE inventario SET equipado = 1 WHERE id = ? AND jogador_id = ?')
    .run(inventario_id, jogador_id);
});

/**
 * Consome um item do inventário (reduz quantidade ou remove).
 * Busca por nome parcial, case-insensitive.
 * Retorna o item consumido ou null se não encontrado.
 */
export const consumeItem = db.transaction((jogador_id, nome_item_parcial) => {
  const item = db.prepare(`
    SELECT inv.id AS inventario_id, inv.quantidade, it.nome, it.dano_ou_efeito
    FROM inventario inv
    JOIN itens it ON inv.item_id = it.id
    WHERE inv.jogador_id = ? AND it.nome LIKE ? COLLATE NOCASE
    LIMIT 1
  `).get(jogador_id, `%${nome_item_parcial}%`);

  if (!item) return null;

  if (item.quantidade > 1) {
    db.prepare('UPDATE inventario SET quantidade = quantidade - 1 WHERE id = ?').run(item.inventario_id);
  } else {
    db.prepare('DELETE FROM inventario WHERE id = ?').run(item.inventario_id);
  }

  return item;
});

// ==========================================
// MUNDO VIVO — ENTIDADES
// ==========================================

/**
 * Instancia uma entidade no mundo vivo a partir de um template de NPC ou Monstro.
 * Retorna o ID da nova entidade ativa.
 */
export const spawnEntity = db.transaction((nome_template, tipo_entidade) => {
  const tableName = tipo_entidade === 'npc' ? 'npcs' : 'monstros';
  const template  = db.prepare(`SELECT * FROM ${tableName} WHERE nome LIKE ? LIMIT 1`)
    .get(`%${nome_template}%`);

  if (!template) throw new Error(`Template "${nome_template}" não encontrado em ${tableName}.`);

  const hpBase = template.hp ?? template.hp_maximo ?? 10;

  const result = db.prepare(`
    INSERT INTO entidades_vivas (
      tipo_entidade, template_id, nome_unico,
      hp_maximo, hp_atual, ca, nivel,
      forca, destreza, resistencia, inteligencia, sabedoria, carisma, ouro,
      memoria, relacao_com_jogador, objetivo, faccao, inimigos, aliados, territorio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tipo_entidade,
    template.id,
    template.nome_unico ?? template.nome,
    hpBase, hpBase,
    template.ca ?? 10,
    template.nivel ?? 1,
    template.forca ?? 10, template.destreza ?? 10, template.resistencia ?? 10,
    template.inteligencia ?? 10, template.sabedoria ?? 10, template.carisma ?? 10,
    template.ouro ?? 0,
    template.memoria    ?? '[]',
    template.relacao_com_jogador ?? 'Desconhecido',
    template.objetivo   ?? '',
    template.faccao     ?? '',
    template.inimigos   ?? '[]',
    template.aliados    ?? '[]',
    template.territorio ?? ''
  );

  logWorldEvent('spawn', `${template.nome} apareceu no mundo.`, [result.lastInsertRowid]);
  return result.lastInsertRowid;
});

export function getActiveEntityByName(nome) {
  const stmt = db.prepare(`
    SELECT * FROM entidades_vivas
    WHERE nome_unico LIKE ? AND status != 'morto'
    LIMIT 1
  `);
  return hydrateJsonFields(stmt.get(`%${nome}%`));
}

/**
 * Retorna a entidade viva com os stats base do template mesclados.
 * Stats da entidade_viva têm precedência sobre o template.
 */
export function getActiveEntity(id_ativo) {
  const entidade = db.prepare('SELECT * FROM entidades_vivas WHERE id = ?').get(id_ativo);
  if (!entidade) return null;

  let baseStats = {};
  if (entidade.template_id) {
    const table = entidade.tipo_entidade === 'npc' ? 'npcs' : 'monstros';
    baseStats   = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entidade.template_id) ?? {};
  }

  const merged = {
    ca: 10, forca: 10, destreza: 10, resistencia: 10, inteligencia: 10, sabedoria: 10, carisma: 10,
    ...baseStats,
    ...entidade,
    ativo_id: entidade.id,
    // CA efetiva considera bônus Nemesis
    ca_efetiva:   (entidade.ca   ?? baseStats.ca   ?? 10) + (entidade.bonus_ca   ?? 0),
    dano_bonus:   entidade.bonus_dano ?? 0,
  };

  return hydrateJsonFields(merged);
}

export function getActiveEnemies(status = null) {
  if (status) {
    return db.prepare(`SELECT * FROM entidades_vivas WHERE status = ?`).all(status).map(e => hydrateJsonFields(e));
  }
  return db.prepare(`SELECT * FROM entidades_vivas WHERE status != 'morto'`).all().map(e => hydrateJsonFields(e));
}

/**
 * Atualiza o HP de uma entidade ativa.
 * Calcula automaticamente o status baseado no novo HP.
 */
export function updateActiveEntityHP(id_ativo, novo_hp, statusOverride = null) {
  const entidade = db.prepare('SELECT hp_maximo, status FROM entidades_vivas WHERE id = ?').get(id_ativo);
  if (!entidade) return null;

  const hpFinal  = Math.max(0, Math.min(novo_hp, entidade.hp_maximo));
  // A 0 HP o padrão é morrer — mas um chamador pode pedir explicitamente 'inconsciente'
  // (ex.: estabilizar um aliado caído) em vez de matar a entidade. Sem esse override,
  // o comportamento é idêntico ao de sempre.
  const novoStatus = hpFinal <= 0
    ? (statusOverride === 'inconsciente' ? 'inconsciente' : 'morto')
    : (statusOverride ?? entidade.status);

  db.prepare(`
    UPDATE entidades_vivas
    SET hp_atual = ?, status = ?, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hpFinal, novoStatus, id_ativo);

  if (novoStatus === 'morto') {
    const entidadeNome = db.prepare('SELECT nome_unico FROM entidades_vivas WHERE id = ?').get(id_ativo);
    logWorldEvent('morte', `${entidadeNome?.nome_unico ?? 'Entidade'} foi derrotada.`, [id_ativo]);
  }

  return { hpFinal, status: novoStatus };
}

/**
 * Aplica evolução Nemesis a uma entidade — buff permanente após sobreviver a combate.
 * CORRIGIDO: hp_atual agora é calculado proporcionalmente, não como hp_maximo + delta.
 */
export const applyNemesisEvolution = db.transaction((id_ativo, evoData) => {
  const entidade = db.prepare('SELECT hp_maximo, hp_atual, bonus_ca, bonus_dano FROM entidades_vivas WHERE id = ?')
    .get(id_ativo);
  if (!entidade) throw new Error(`Entidade ${id_ativo} não encontrada.`);

  const deltaHp = evoData.alteracao_hp_maximo ?? 0;
  const novoHpMaximo = entidade.hp_maximo + deltaHp;
  // Mantém HP atual proporcional ao máximo (não zera nem ultrapassa o novo máximo)
  const novoHpAtual  = Math.min(entidade.hp_atual + deltaHp, novoHpMaximo);

  db.prepare(`
    UPDATE entidades_vivas
    SET
      nome_unico              = ?,
      historico_consequencias = ?,
      nova_personalidade      = ?,
      hp_maximo               = ?,
      hp_atual                = ?,
      bonus_ca                = ?,
      bonus_dano              = ?,
      atualizado_em           = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    evoData.novo_nome,
    evoData.novo_historico,
    evoData.nova_personalidade,
    novoHpMaximo,
    novoHpAtual,
    (entidade.bonus_ca   ?? 0) + (evoData.alteracao_bonus_ca   ?? 0),
    (entidade.bonus_dano ?? 0) + (evoData.alteracao_bonus_dano ?? 0),
    id_ativo
  );

  logWorldEvent('nemesis', `${evoData.novo_nome} evoluiu pelo sistema Nemesis.`, [id_ativo]);
  return { novoHpMaximo, novoHpAtual };
});

// ==========================================
// SESSÕES DO RPG MASTER (CONTEXTO DO OLLAMA)
// ==========================================

/**
 * Cria uma nova sessão para o jogador.
 */
export function createSession(jogador_id, titulo = 'Nova Sessão') {
  const result = db.prepare(`
    INSERT INTO sessoes (jogador_id, titulo, mensagens)
    VALUES (?, ?, '[]')
  `).run(jogador_id, titulo);
  return result.lastInsertRowid;
}

/**
 * Retorna as mensagens da sessão como array, prontas para enviar ao Ollama.
 */
export function getSessionMessages(sessao_id) {
  const sessao = db.prepare('SELECT mensagens FROM sessoes WHERE id = ?').get(sessao_id);
  return parseJson(sessao?.mensagens);
}

/**
 * Adiciona uma mensagem ao histórico da sessão.
 * @param {number} sessao_id
 * @param {'user'|'assistant'|'system'} role
 * @param {string} content
 */
export function addMessageToSession(sessao_id, role, content) {
  const mensagens = getSessionMessages(sessao_id);
  mensagens.push({ role, content });
  return db.prepare(`
    UPDATE sessoes
    SET mensagens = ?, atualizada_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(toJson(mensagens), sessao_id);
}

/**
 * Retorna a sessão ativa mais recente do jogador (ou cria uma nova).
 */
export function getOrCreateActiveSession(jogador_id) {
  const sessao = db.prepare(`
    SELECT * FROM sessoes
    WHERE jogador_id = ? AND ativa = 1
    ORDER BY atualizada_em DESC
    LIMIT 1
  `).get(jogador_id);

  if (sessao) return { ...sessao, mensagens: parseJson(sessao.mensagens) };

  const id = createSession(jogador_id);
  return { id, jogador_id, mensagens: [], titulo: 'Nova Sessão' };
}

/**
 * Limpa o histórico de uma sessão (útil para resetar contexto sem deletar a sessão).
 */
export function clearSessionMessages(sessao_id) {
  return db.prepare(`
    UPDATE sessoes SET mensagens = '[]', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?
  `).run(sessao_id);
}

// ==========================================
// LOG DE EVENTOS DO MUNDO VIVO
// ==========================================

/**
 * Registra um evento no log do mundo.
 * Pode ser chamado internamente por qualquer operação relevante.
 */
export function logWorldEvent(tipo, descricao, entidades = [], localizacao = null) {
  return db.prepare(`
    INSERT INTO eventos_mundo (tipo, descricao, entidades, localizacao)
    VALUES (?, ?, ?, ?)
  `).run(tipo, descricao, toJson(entidades), localizacao);
}

export function getRecentEvents(limit = 20) {
  return db.prepare(`
    SELECT * FROM eventos_mundo
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(limit);
}

export function getEventsByType(tipo, limit = 10) {
  return db.prepare(`
    SELECT * FROM eventos_mundo WHERE tipo = ?
    ORDER BY criado_em DESC LIMIT ?
  `).all(tipo, limit);
}

// ==========================================
// LOCALIZAÇÕES
// ==========================================

export function insertLocation(loc) {
  return db.prepare(`
    INSERT INTO localizacoes (nome, tipo, descricao, locais_conectados, npcs_fixos, itens_locais, perigo)
    VALUES (@nome, @tipo, @descricao, @locais_conectados, @npcs_fixos, @itens_locais, @perigo)
  `).run({
    ...loc,
    locais_conectados: toJson(loc.locais_conectados),
    npcs_fixos:        toJson(loc.npcs_fixos),
    itens_locais:      toJson(loc.itens_locais),
  });
}

export function getLocationByName(nome) {
  const loc = db.prepare('SELECT * FROM localizacoes WHERE nome LIKE ? LIMIT 1').get(`%${nome}%`);
  if (!loc) return null;
  return {
    ...loc,
    locais_conectados: parseJson(loc.locais_conectados),
    npcs_fixos:        parseJson(loc.npcs_fixos),
    itens_locais:      parseJson(loc.itens_locais),
  };
}

// ==========================================
// UTILITÁRIOS GERAIS
// ==========================================

/**
 * Retorna um resumo do estado atual do mundo — útil para montar o prompt do Ollama.
 */
export function getWorldSnapshot(jogador_id) {
  const player    = getPlayer(jogador_id);
  const enemies   = getActiveEnemies();
  const events    = getRecentEvents(5);
  const inventory = getPlayerInventory(jogador_id);
  const session   = getOrCreateActiveSession(jogador_id);

  return { player, enemies, events, inventory, session };
}

/**
 * Fecha o banco de forma segura (útil em testes e teardown).
 */
export function closeDatabase() {
  db.close();
}

export default db;