// ==========================================
// RESOURCE ENGINE — VEXON
// API genérica para os pontos de recurso por classe (PE/PU/PS/...) — ver
// docs/plano-pontos-recurso.md para o levantamento completo das 9 classes
// e a ordem de implementação. Cobre só as classes com `recurso_classe`
// definido em classData.js (Tier 1: Arconte, Anomalia Bioenergética,
// Ilusionista das Sombras) — as demais não têm o campo ainda.
// ==========================================

import { getPlayer, gastarRecursoClasse, resetRecursoClasse } from "../db/database.js";
import { getClasse } from "../classData.js";

/**
 * Máximo do recurso de classe: igual ao nível do personagem, disponível só
 * a partir do nível 2 (nível 1 não tem pontos), conforme a tabela de todas
 * as classes de recurso plano no Readme.txt.
 */
function maximoRecurso(nivel) {
  return nivel >= 2 ? nivel : 0;
}

function getRecursoClasseInfo(player) {
  const classeInfo = player.classe ? getClasse(player.classe) : null;
  return classeInfo?.recurso_classe ?? null;
}

/**
 * Consulta o estado atual do recurso de classe do jogador.
 * Retorna null se a classe não tem recurso definido.
 */
export function consultarRecurso(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);

  const recursoInfo = getRecursoClasseInfo(player);
  if (!recursoInfo) return null;

  const maximo = maximoRecurso(player.nivel);
  const atual  = Math.max(0, maximo - (player.recurso_classe_gasto || 0));
  return { nome: recursoInfo.nome, sigla: recursoInfo.sigla, atual, maximo };
}

/**
 * Gasta `quantidade` pontos do recurso de classe. Lança erro se a classe
 * não tiver recurso, ou se o saldo disponível for insuficiente.
 */
export function gastarRecurso(jogador_id, quantidade = 1) {
  const recurso = consultarRecurso(jogador_id);
  if (!recurso) throw new Error("Esta classe não tem um recurso de classe implementado.");
  if (recurso.atual < quantidade) {
    throw new Error(`${recurso.sigla} insuficiente: disponível ${recurso.atual}, precisa de ${quantidade}.`);
  }
  gastarRecursoClasse(jogador_id, quantidade);
  return { ...recurso, atual: recurso.atual - quantidade };
}

/**
 * Recupera o recurso de classe por completo — chamado por descansoCurto e
 * descansoLongo (restEngine.js), já que PE/PU/PS/PA/PR/FV recuperam 100%
 * nos dois tipos de descanso (Readme.txt:1692-1704).
 */
export function recuperarRecurso(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (!getRecursoClasseInfo(player)) return null;

  resetRecursoClasse(jogador_id);
  return consultarRecurso(jogador_id);
}
