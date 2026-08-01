// ==========================================
// DEATH ENGINE — VEXON
// Teste contra a Morte, conforme Readme.txt
// (seção "Caindo a 0 Pontos de Vida").
// ==========================================

import {
  getPlayer,
  registrarDeathSave,
  getActiveEntityByName,
  updateActiveEntityHP,
} from "../db/database.js";
import { rollDice } from "./diceEngine.js";
import { rollD20Test } from "./skillEngine.js";

const SUCESSOS_PARA_ESTABILIZAR = 3;
const FALHAS_PARA_MORRER        = 3;
const CD_ESTABILIZAR            = 10;

/**
 * Rola um teste contra a morte para um jogador inconsciente (0 HP).
 * d20 puro, sem modificadores:
 *   20 natural  -> recupera 1 HP e volta consciente (status 'ativo')
 *   1 natural   -> conta como 2 falhas
 *   10 ou mais  -> 1 sucesso (3 sucessos = estabiliza, status 'estavel')
 *   9 ou menos  -> 1 falha (3 falhas = morre, status 'morto')
 */
export function rollDeathSave(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (player.status !== "inconsciente") {
    throw new Error(`${player.nome} não está fazendo um teste contra a morte (status atual: ${player.status}).`);
  }

  const dado = rollDice("1d20");

  // 20 natural — recupera 1 HP e volta consciente imediatamente
  if (dado === 20) {
    registrarDeathSave(jogador_id, { sucessos: 0, falhas: 0, status: "ativo", hp: 1 });
    return {
      dado, natural20: true, natural1: false,
      sucessos: 0, falhas: 0,
      status: "ativo",
      resultado: "recuperou_consciencia",
    };
  }

  let { death_save_sucessos: sucessos, death_save_falhas: falhas } = player;

  if (dado === 1) {
    falhas += 2;
  } else if (dado >= 10) {
    sucessos += 1;
  } else {
    falhas += 1;
  }

  let novoStatus = "inconsciente";
  let resultado  = dado >= 10 ? "sucesso" : "falha";

  if (falhas >= FALHAS_PARA_MORRER) {
    novoStatus = "morto";
    resultado  = "morreu";
  } else if (sucessos >= SUCESSOS_PARA_ESTABILIZAR) {
    novoStatus = "estavel";
    resultado  = "estabilizou";
  }

  registrarDeathSave(jogador_id, { sucessos, falhas, status: novoStatus });

  return {
    dado, natural20: false, natural1: dado === 1,
    sucessos, falhas,
    status: novoStatus,
    resultado,
  };
}

/**
 * Sofrer dano enquanto já está a 0 HP conta automaticamente como falha no teste
 * contra a morte (2 falhas se o golpe foi crítico) — sem rolar dado nenhum.
 */
export function aplicarDanoEm0HP(jogador_id, critico = false) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (player.status !== "inconsciente") return null;

  const falhas = player.death_save_falhas + (critico ? 2 : 1);
  const morreu = falhas >= FALHAS_PARA_MORRER;

  registrarDeathSave(jogador_id, {
    sucessos: player.death_save_sucessos,
    falhas,
    status: morreu ? "morto" : "inconsciente",
  });

  return {
    falhas_adicionadas: critico ? 2 : 1,
    falhas_total: falhas,
    status: morreu ? "morto" : "inconsciente",
    morreu,
  };
}

/**
 * Um aliado tenta estabilizar uma entidade (NPC/monstro) inconsciente na cena,
 * via teste de Inteligência (Medicina) CD 10. Sucesso a traz de volta com 1 HP.
 * (O próprio jogador nunca é alvo aqui — ele não pode agir enquanto inconsciente;
 * a recuperação dele é só via rollDeathSave, rodado automaticamente a cada turno.)
 */
export function estabilizarAliado(jogador_id, alvoNome) {
  if (!alvoNome?.trim()) throw new Error("É preciso dizer quem você está tentando estabilizar.");

  const entidade = getActiveEntityByName(alvoNome);
  if (!entidade) throw new Error(`Não há ninguém chamado "${alvoNome}" na cena.`);
  if (entidade.status !== "inconsciente") {
    throw new Error(`${entidade.nome_unico} não está inconsciente — não precisa ser estabilizado(a).`);
  }

  const teste = rollD20Test(jogador_id, "inteligencia", CD_ESTABILIZAR);

  if (teste.sucesso) {
    updateActiveEntityHP(entidade.ativo_id ?? entidade.id, 1, "vivo");
  }

  return {
    alvo: entidade.nome_unico,
    teste,
    estabilizado: teste.sucesso,
  };
}

export function setupDeathRoutes(app) {
  app.post("/api/death/save", (req, res) => {
    const { jogador_id } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });
    try {
      const resultado = rollDeathSave(Number(jogador_id));
      res.json({ sucesso: true, resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  app.post("/api/death/estabilizar", (req, res) => {
    const { jogador_id, alvo } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });
    try {
      const resultado = estabilizarAliado(Number(jogador_id), alvo);
      res.json({ sucesso: true, resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[DeathEngine] Rotas registradas: /api/death/*");
}
