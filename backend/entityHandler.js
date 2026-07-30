// ==========================================
// MOTOR DE CRIAÇÃO DE ENTIDADES — VEXON
// ==========================================

import {
  insertNpc,
  insertMonster,
  insertItem,
  toJson,
} from "./db/database.js";
import { calculateModifier } from "./engine/diceEngine.js";

// ==========================================
// CONSTANTES E TABELAS
// ==========================================

// Atributos válidos — whitelist estrita
const ATRIBUTOS_VALIDOS = new Set(["FOR", "DES", "RES", "INT", "SAB", "CAR"]);

// Mapeamento atributo curto → campo do banco
const ATTR_MAP = {
  FOR: "forca",
  DES: "destreza",
  RES: "resistencia",
  INT: "inteligencia",
  SAB: "sabedoria",
  CAR: "carisma",
};

// Nível social → poder base (escala 1–5)
const NIVEL_SOCIAL_MAP = {
  servo:      1,
  comum:      1,
  artesao:    2,
  influente:  3,
  nobre:      4,
  lider:      5,
};

// Alinhamento → tendências de comportamento social
const ALINHAMENTO_MAP = {
  "leal bom":      { cooperacao: 5, traicao: 1, agressividade: 1 },
  "neutro bom":    { cooperacao: 4, traicao: 1, agressividade: 2 },
  "caótico bom":   { cooperacao: 3, traicao: 2, agressividade: 2 },
  "leal neutro":   { cooperacao: 4, traicao: 2, agressividade: 2 },
  "neutro":        { cooperacao: 2, traicao: 2, agressividade: 2 },
  "caótico neutro":{ cooperacao: 2, traicao: 3, agressividade: 3 },
  "leal maligno":  { cooperacao: 2, traicao: 3, agressividade: 4 },
  "neutro maligno":{ cooperacao: 1, traicao: 4, agressividade: 4 },
  "caótico maligno":{ cooperacao: 1, traicao: 5, agressividade: 5 },
};

// Ameaça → multiplicador de nível relativo ao jogador
const AMEACA_MAP = {
  trivial:  -2,
  baixa:    -1,
  media:     0,
  alta:     +1,
  elite:    +2,
  chefe:    +3,
  lendario: +5,
};

// Raridade de itens → multiplicador de valor base
const RARIDADE_VALOR = {
  comum:    1,
  incomum:  3,
  rara:     10,
  muito_rara: 50,
  lendaria: 200,
  artefato: 1000,
};

// ==========================================
// VALIDAÇÃO GENÉRICA
// ==========================================

/**
 * Lança um erro descritivo se um campo obrigatório estiver ausente.
 */
function exigir(data, ...campos) {
  for (const campo of campos) {
    if (data[campo] === undefined || data[campo] === null || data[campo] === "") {
      throw new Error(`Campo obrigatório ausente: "${campo}".`);
    }
  }
}

/**
 * Sanitiza uma string — remove espaços extras, limita tamanho.
 */
function sanitizeStr(val, maxLen = 200, fallback = "") {
  if (!val) return fallback;
  return String(val).trim().slice(0, maxLen);
}

/**
 * Garante que um valor numérico esteja entre min e max.
 */
function clamp(val, min, max) {
  const n = Number(val);
  return isNaN(n) ? min : Math.max(min, Math.min(max, n));
}

// ==========================================
// GERADOR DE ATRIBUTOS
// ==========================================

/**
 * Gera os 6 atributos de uma entidade baseado no nível e destaques.
 *
 * Fórmula:
 * - Base: 10 para todos
 * - Destaques (máx 2): base + (nível × 2) + 4
 * - Secundários (próximos 2 no array): base + nível
 * - Resto: 10
 *
 * Isso garante que destaques sejam claramente superiores
 * mas secundários também crescem um pouco com o nível.
 */
function gerarAtributos(nivel, atributos_destaque = []) {
  const stats = { FOR: 10, DES: 10, RES: 10, INT: 10, SAB: 10, CAR: 10 };

  const destaques = (Array.isArray(atributos_destaque) ? atributos_destaque : [])
    .map(a => String(a).toUpperCase().trim())
    .filter(a => ATRIBUTOS_VALIDOS.has(a))
    .slice(0, 2);

  // Bônus primário: destaques
  for (const attr of destaques) {
    stats[attr] = 10 + (nivel * 2) + 4;
  }

  // Bônus secundário: os atributos logo após os destaques no array (se existirem)
  const todos     = [...ATRIBUTOS_VALIDOS];
  const restantes = todos.filter(a => !destaques.includes(a));
  const secundarios = restantes.slice(0, 2);

  for (const attr of secundarios) {
    stats[attr] = 10 + nivel;
  }

  // Clamp: atributos entre 3 e 30
  for (const attr of todos) {
    stats[attr] = clamp(stats[attr], 3, 30);
  }

  return stats;
}

/**
 * Converte stats curtos (FOR, DES…) para campos do banco (forca, destreza…).
 */
function atributosParaBanco(stats) {
  const result = {};
  for (const [curto, longo] of Object.entries(ATTR_MAP)) {
    result[longo] = stats[curto] ?? 10;
  }
  return result;
}

// ==========================================
// HELPERS DE FÓRMULAS
// ==========================================

/**
 * HP de NPC: (nível × 8) + (mod Resistência × nível), mínimo 5.
 * NPCs são mais resistentes que monstros comuns.
 */
function calcularHpNpc(nivel, modRes) {
  return Math.max(5, (nivel * 8) + (modRes * nivel));
}

/**
 * HP de Monstro: (nível × 10) + (mod Resistência × nível), mínimo 1.
 * Monstros têm HP um pouco maior — são criaturas para combate.
 */
function calcularHpMonstro(nivel, modRes) {
  return Math.max(1, (nivel * 10) + (modRes * nivel));
}

/**
 * CA base para NPCs: 11 + mod Destreza.
 * CA base para Monstros: 10 + mod Destreza + (nível / 2 arredondado).
 * Monstros de nível mais alto ganham CA natural (couro mais grosso, etc.)
 */
function calcularCaNpc(modDes)           { return clamp(11 + modDes, 8, 22); }
function calcularCaMonstro(nivel, modDes){ return clamp(10 + modDes + Math.floor(nivel / 2), 8, 25); }

// ==========================================
// EXPORTAÇÕES UTILITÁRIAS
// ==========================================

export function traduzirNivelSocial(nivel_social) {
  const chave = sanitizeStr(nivel_social).toLowerCase();
  return NIVEL_SOCIAL_MAP[chave] ?? 1;
}

export function definirTendencia(alinhamento) {
  const chave = sanitizeStr(alinhamento).toLowerCase();
  // Busca exato primeiro, depois busca parcial
  if (ALINHAMENTO_MAP[chave]) return ALINHAMENTO_MAP[chave];
  const parcial = Object.entries(ALINHAMENTO_MAP)
    .find(([k]) => k.includes(chave) || chave.includes(k));
  return parcial ? parcial[1] : ALINHAMENTO_MAP["neutro"];
}

export function traduzirAmeacaParaNivel(ameaca, playerLevel) {
  const chave = sanitizeStr(ameaca).toLowerCase();
  const delta = AMEACA_MAP[chave] ?? 0;
  return Math.max(1, (playerLevel || 1) + delta);
}

// ==========================================
// HANDLER: ITEM
// ==========================================

/**
 * Valida, normaliza e insere um item no banco.
 * Retorna o item inserido com o ID do banco.
 *
 * @param {object} data - Dados brutos do item
 * @param {boolean} persistir - Se true, insere no banco (padrão: true)
 */
export async function handleItemCreation(data, persistir = true) {
  exigir(data, "nome", "tipo");

  const raridade = sanitizeStr(data.raridade, 50, "comum").toLowerCase();
  const multiplicador = RARIDADE_VALOR[raridade] ?? 1;
  const valorBase = data.valor ?? `${multiplicador * 10} po`;

  const item = {
    nome:               sanitizeStr(data.nome, 100),
    tipo:               sanitizeStr(data.tipo, 50).toLowerCase(),
    raridade,
    dano_ou_efeito:     sanitizeStr(data.dano_ou_efeito, 100, null),
    propriedades:       sanitizeStr(data.propriedades, 200, null),
    peso:               sanitizeStr(data.peso, 30, "0 kg"),
    valor:              sanitizeStr(String(valorBase), 50, "0 po"),
    descricao:          sanitizeStr(data.descricao, 500, ""),
    habilidade_tematica:sanitizeStr(data.habilidade_tematica, 100, null),
  };

  if (!persistir) return item;

  const result = insertItem(item);
  return { ...item, id: result.lastInsertRowid };
}

// ==========================================
// HANDLER: NPC
// ==========================================

/**
 * Valida, gera atributos e insere um NPC no banco.
 *
 * @param {object} data
 * @param {boolean} persistir
 */
export async function handleNpcCreation(data, persistir = true) {
  exigir(data, "nome", "alinhamento");

  const nivelSocial = traduzirNivelSocial(data.nivel_social ?? "comum");
  const tendencia   = definirTendencia(data.alinhamento);
  const stats       = gerarAtributos(nivelSocial, data.atributos_destaque);
  const modRes      = calculateModifier(stats.RES);
  const modDes      = calculateModifier(stats.DES);
  const hpFinal     = calcularHpNpc(nivelSocial, modRes);
  const caFinal     = calcularCaNpc(modDes);
  const atrs        = atributosParaBanco(stats);

  const npc = {
    nome:               sanitizeStr(data.nome, 100),
    tamanho:            sanitizeStr(data.tamanho, 30, "Médio"),
    tipo:               sanitizeStr(data.tipo, 50, "humanoide"),
    alinhamento:        sanitizeStr(data.alinhamento, 50),
    nivel_social:       sanitizeStr(data.nivel_social, 50, "comum"),
    arquetipo:          sanitizeStr(data.arquetipo, 100, ""),
    deslocamento:       sanitizeStr(data.deslocamento, 20, "9m"),
    ca:                 caFinal,
    hp:                 hpFinal,
    nivel:              nivelSocial,
    idiomas:            sanitizeStr(data.idiomas, 200, "Comum"),
    personalidade:      sanitizeStr(data.personalidade, 500, ""),
    descricao:          sanitizeStr(data.descricao, 500, ""),
    influencia:         clamp(nivelSocial * 10, 0, 100),
    tendencia:          toJson(tendencia),
    habilidades_passivas: toJson(data.habilidades_passivas ?? []),
    acoes:              toJson(data.acoes ?? []),
    memoria:            toJson(data.memoria ?? []),
    relacao_com_jogador:sanitizeStr(data.relacao_com_jogador, 100, "Desconhecido"),
    objetivo:           sanitizeStr(data.objetivo, 300, "Sobreviver"),
    faccao:             sanitizeStr(data.faccao, 100, "Nenhuma"),
    inimigos:           toJson(data.inimigos ?? []),
    aliados:            toJson(data.aliados ?? []),
    territorio:         sanitizeStr(data.territorio, 200, "Desconhecido"),
    ouro:               clamp(data.ouro ?? 0, 0, 999999),
    ...atrs,
  };

  if (!persistir) return npc;

  const result = insertNpc(npc);
  return { ...npc, id: result.lastInsertRowid };
}

// ==========================================
// HANDLER: MONSTRO
// ==========================================

/**
 * Valida, gera atributos escalados e insere um monstro no banco.
 *
 * @param {object} data
 * @param {number} playerLevel  - Nível do jogador (para escalar ameaça)
 * @param {boolean} persistir
 */
export async function handleMonsterCreation(data, playerLevel = 1, persistir = true) {
  exigir(data, "nome");

  const nivelFinal = traduzirAmeacaParaNivel(data.ameaca ?? "media", playerLevel);
  const stats      = gerarAtributos(nivelFinal, data.atributos_destaque);
  const modRes     = calculateModifier(stats.RES);
  const modDes     = calculateModifier(stats.DES);
  const hpFinal    = calcularHpMonstro(nivelFinal, modRes);
  const caFinal    = calcularCaMonstro(nivelFinal, modDes);
  const atrs       = atributosParaBanco(stats);

  const monstro = {
    nome:               sanitizeStr(data.nome, 100),
    nome_unico:         sanitizeStr(data.nome_unico ?? data.nome, 100),
    tamanho:            sanitizeStr(data.tamanho, 30, "Médio"),
    tipo:               sanitizeStr(data.tipo, 50, "monstro"),
    alinhamento:        sanitizeStr(data.alinhamento, 50, "neutro"),
    deslocamento:       sanitizeStr(data.deslocamento, 20, "9m"),
    ca:                 caFinal,
    hp_maximo:          hpFinal,
    hp_atual:           hpFinal,
    nivel:              nivelFinal,
    ameaca:             sanitizeStr(data.ameaca, 30, "media"),
    idiomas:            sanitizeStr(data.idiomas, 200, "Nenhum"),
    descricao:          sanitizeStr(data.descricao, 500, ""),
    habilidades_passivas: toJson(data.habilidades_passivas ?? []),
    acoes:              toJson(data.acoes ?? []),
    memoria:            toJson(data.memoria ?? []),
    relacao_com_jogador:sanitizeStr(data.relacao_com_jogador, 100, "Agressivo"),
    objetivo:           sanitizeStr(data.objetivo, 300, "Caçar/Proteger território"),
    faccao:             sanitizeStr(data.faccao, 100, "Nenhuma"),
    inimigos:           toJson(data.inimigos ?? []),
    aliados:            toJson(data.aliados ?? []),
    territorio:         sanitizeStr(data.territorio, 200, "Desconhecido"),
    ouro:               clamp(data.ouro ?? Math.floor(nivelFinal * 5), 0, 999999),
    ...atrs,
  };

  if (!persistir) return monstro;

  const result = insertMonster(monstro);
  return { ...monstro, id: result.lastInsertRowid };
}

// ==========================================
// HANDLER UNIFICADO (para chamadas da IA)
// ==========================================

/**
 * Roteador unificado — recebe o JSON de tool-use da IA e despacha
 * para o handler correto baseado no campo `tipo_entidade`.
 *
 * Uso: await handleEntityCreation({ tipo_entidade: "monstro", nome: "Golem", ... }, playerLevel)
 */
export async function handleEntityCreation(data, playerLevel = 1, persistir = true) {
  const tipo = sanitizeStr(data.tipo_entidade ?? data.tipo ?? "", 30).toLowerCase();

  switch (tipo) {
    case "npc":
      return handleNpcCreation(data, persistir);
    case "monstro":
    case "monster":
    case "criatura":
      return handleMonsterCreation(data, playerLevel, persistir);
    case "item":
    case "arma":
    case "armadura":
    case "consumivel":
      return handleItemCreation(data, persistir);
    default:
      throw new Error(`Tipo de entidade desconhecido: "${tipo}". Use "npc", "monstro" ou "item".`);
  }
}

// ==========================================
// GERADOR DE ENTIDADE RÁPIDA (para spawns dinâmicos)
// ==========================================

/**
 * Gera um monstro básico a partir de só um nome e nível.
 * Usado pelo gameEngine quando precisa criar um inimigo on-the-fly
 * sem dados detalhados da IA.
 *
 * @param {string} nome
 * @param {number} nivel
 * @param {string} ameaca
 * @param {boolean} persistir
 */
export async function gerarMonstroRapido(nome, nivel = 1, ameaca = "media", persistir = true) {
  return handleMonsterCreation({
    nome,
    ameaca,
    tipo:        "monstro",
    alinhamento: "neutro maligno",
    descricao:   `${nome} — criatura surgida das sombras de Vexon.`,
    acoes: [{ nome: "Ataque", dano: `${Math.max(1, Math.floor(nivel / 2))}d6`, descricao: "Ataque corpo a corpo" }],
  }, nivel, persistir);
}

/**
 * Gera um NPC neutro básico a partir de nome e arquétipo.
 * Usado para criar NPCs de passagem sem precisar de dados completos.
 */
export async function gerarNpcRapido(nome, arquetipo = "civil", nivel_social = "comum", persistir = true) {
  return handleNpcCreation({
    nome,
    arquetipo,
    nivel_social,
    alinhamento:  "neutro",
    descricao:    `${nome} — habitante de Vexon.`,
    personalidade:"Reservado e cauteloso com estranhos.",
  }, persistir);
}