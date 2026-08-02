// ==========================================
// CONDITION ENGINE — VEXON
// Vantagem/Desvantagem e efeitos mecânicos das 7 condições oficiais
// (Readme.txt, "Glossário de Condições"): Amedrontado, Atordoado, Caído,
// Cego, Invisível, Paralisado, Silenciado.
// ==========================================
// Escopo desta versão: só o efeito mecânico central de cada condição
// (vantagem/desvantagem em ataques e testes, falha automática onde
// aplicável, crítico automático do Paralisado). Não modela: linha de
// visão do Amedrontado (sem sistema de posição/visão no motor — o efeito
// vale enquanto a condição existir), rastejar/levantar do Caído (sem
// sistema de movimento posicional), incapacitação de Atordoado/Paralisado
// (exigiria um conceito de economia de ação que não existe no motor).
// Nenhuma habilidade do jogo hoje aplica estas condições a alguém — isso é
// infraestrutura pronta para uso futuro por habilidades de classe.

import db from "../db/database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS condicoes_ativas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id INTEGER DEFAULT NULL,
    entidade_id INTEGER DEFAULT NULL,
    tipo TEXT NOT NULL,
    turnos_restantes INTEGER DEFAULT NULL,
    criado_em INTEGER DEFAULT (strftime('%s','now') * 1000),
    CHECK ((jogador_id IS NOT NULL) != (entidade_id IS NOT NULL))
  )
`);

export const CONDICOES_VALIDAS = new Set([
  "amedrontado", "atordoado", "caido", "cego", "invisivel", "paralisado", "silenciado",
]);

function colunaAlvo(alvo) {
  if (alvo?.jogador_id != null) return { coluna: "jogador_id", valor: alvo.jogador_id };
  if (alvo?.entidade_id != null) return { coluna: "entidade_id", valor: alvo.entidade_id };
  throw new Error("Alvo inválido: informe { jogador_id } ou { entidade_id }.");
}

// ==========================================
// CRUD
// ==========================================

export function adicionarCondicao(alvo, tipo, { turnos = null } = {}) {
  if (!CONDICOES_VALIDAS.has(tipo)) throw new Error(`Condição desconhecida: "${tipo}".`);
  const { coluna, valor } = colunaAlvo(alvo);

  const existente = db.prepare(
    `SELECT id FROM condicoes_ativas WHERE ${coluna} = ? AND tipo = ?`
  ).get(valor, tipo);

  if (existente) {
    db.prepare(`UPDATE condicoes_ativas SET turnos_restantes = ? WHERE id = ?`).run(turnos, existente.id);
    return existente.id;
  }
  const info = db.prepare(
    `INSERT INTO condicoes_ativas (${coluna}, tipo, turnos_restantes) VALUES (?, ?, ?)`
  ).run(valor, tipo, turnos);
  return info.lastInsertRowid;
}

export function removerCondicao(alvo, tipo) {
  const { coluna, valor } = colunaAlvo(alvo);
  return db.prepare(`DELETE FROM condicoes_ativas WHERE ${coluna} = ? AND tipo = ?`).run(valor, tipo);
}

export function getCondicoesAtivas(alvo) {
  const { coluna, valor } = colunaAlvo(alvo);
  return db.prepare(`SELECT * FROM condicoes_ativas WHERE ${coluna} = ?`).all(valor);
}

export function temCondicao(alvo, tipo) {
  const { coluna, valor } = colunaAlvo(alvo);
  const row = db.prepare(
    `SELECT 1 FROM condicoes_ativas WHERE ${coluna} = ? AND tipo = ? LIMIT 1`
  ).get(valor, tipo);
  return !!row;
}

/**
 * Decrementa turnos_restantes das condições do alvo que têm duração
 * definida, purgando as que chegam a 0. Condições com turnos_restantes
 * NULL (indefinidas) não são tocadas. Chamado uma vez por turno do alvo.
 */
export function decrementarCondicoes(alvo) {
  const { coluna, valor } = colunaAlvo(alvo);
  db.prepare(
    `UPDATE condicoes_ativas SET turnos_restantes = turnos_restantes - 1
     WHERE ${coluna} = ? AND turnos_restantes IS NOT NULL`
  ).run(valor);
  db.prepare(
    `DELETE FROM condicoes_ativas WHERE ${coluna} = ? AND turnos_restantes IS NOT NULL AND turnos_restantes <= 0`
  ).run(valor);
}

// ==========================================
// RESOLUÇÃO DE MODO (vantagem/desvantagem/normal)
// ==========================================

/**
 * Combina vários sinais de vantagem/desvantagem numa única jogada.
 * Regra padrão: vantagem e desvantagem simultâneas se cancelam.
 */
export function combinarModos(sources) {
  const temVantagem = sources.includes("vantagem");
  const temDesvantagem = sources.includes("desvantagem");
  if (temVantagem && temDesvantagem) return "normal";
  if (temVantagem) return "vantagem";
  if (temDesvantagem) return "desvantagem";
  return "normal";
}

/**
 * Modo do PRÓXIMO ataque de `atacante` contra `alvo`.
 * Combina a penalidade/bônus próprio do atacante (Amedrontado/Caído/Cego
 * → desvantagem; Invisível → vantagem) com o que as condições do ALVO
 * concedem a quem o ataca (Atordoado/Paralisado/Cego → vantagem;
 * Invisível → desvantagem; Caído → vantagem se corpo-a-corpo, desvantagem
 * se à distância).
 */
export function resolverModoAtaque(atacante, alvo, { alcanceCorpoACorpo = true } = {}) {
  const sources = [];

  if (temCondicao(atacante, "amedrontado")) sources.push("desvantagem");
  if (temCondicao(atacante, "caido")) sources.push("desvantagem");
  if (temCondicao(atacante, "cego")) sources.push("desvantagem");
  if (temCondicao(atacante, "invisivel")) sources.push("vantagem");

  if (temCondicao(alvo, "atordoado") || temCondicao(alvo, "paralisado")) sources.push("vantagem");
  if (temCondicao(alvo, "cego")) sources.push("vantagem");
  if (temCondicao(alvo, "invisivel")) sources.push("desvantagem");
  if (temCondicao(alvo, "caido")) sources.push(alcanceCorpoACorpo ? "vantagem" : "desvantagem");

  return combinarModos(sources);
}

/**
 * Modo do PRÓXIMO teste de habilidade de `quemTesta` (não-ataque).
 * Só Amedrontado afeta testes de habilidade em geral no Readme.txt —
 * Cego/Caído/Invisível só afetam jogadas de ataque.
 */
export function resolverModoTeste(quemTesta) {
  const modo = temCondicao(quemTesta, "amedrontado") ? "desvantagem" : "normal";
  return { modo };
}

/**
 * Falha automática em teste visual (Cego). Usado só quando a perícia
 * resolvida é especificamente "percepcao" — o livro cita "testes que
 * exijam visão, como Percepção visual" como exemplo, não expandimos por
 * suposição para outras perícias.
 */
export function falhaAutomaticaVisual(quemTesta) {
  return temCondicao(quemTesta, "cego");
}

/**
 * Falha automática em teste de resistência de Força/Destreza
 * (Atordoado/Paralisado).
 */
export function falhaAutomaticaResistencia(quemTesta, atributo) {
  if (atributo !== "forca" && atributo !== "destreza") return false;
  return temCondicao(quemTesta, "atordoado") || temCondicao(quemTesta, "paralisado");
}

/**
 * Regra de Execução do Paralisado: qualquer ataque que ATINJA o alvo
 * paralisado é automaticamente Acerto Crítico, se o atacante estiver
 * corpo-a-corpo. Só upgrada um acerto para crítico — não concede acerto.
 */
export function critAutomaticoPorParalisia(alvo, { alcanceCorpoACorpo = true } = {}) {
  return alcanceCorpoACorpo && temCondicao(alvo, "paralisado");
}
