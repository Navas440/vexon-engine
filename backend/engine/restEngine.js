// ==========================================
// REST ENGINE — VEXON
// Descanso Curto e Descanso Longo, conforme Readme.txt
// (seção "Regras de Descanso").
// ==========================================

import {
  getPlayer,
  updatePlayerHP,
  getActiveEnemies,
  gastarDadosDeVida,
  resetDadosDeVida,
  registrarDescansoLongo,
} from "../db/database.js";
import { getClasse } from "../classData.js";
import { rollDice, calculateModifier } from "./diceEngine.js";

const LIMITE_DESCANSO_LONGO_MS = 24 * 60 * 60 * 1000;

function inimigosPorPerto() {
  return getActiveEnemies().filter(e => e.status !== "morto").length > 0;
}

/**
 * Descanso Curto: gasta até `quantidade_dados` Dados de Vida (limitado ao total
 * disponível, que é igual ao nível do personagem). Cada dado rolado cura
 * 1d{dado_vida da classe} + mod. Resistência, sem passar do hp_maximo.
 */
export function descansoCurto(jogador_id, quantidade_dados = 1) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (player.status === "morto") throw new Error(`${player.nome} está morto.`);
  if (player.status === "inconsciente") throw new Error(`${player.nome} está inconsciente e não pode descansar.`);
  if (inimigosPorPerto()) throw new Error("Não é possível descansar com inimigos por perto.");

  const classeInfo = player.classe ? getClasse(player.classe) : null;
  const dadoVida    = classeInfo?.dado_vida ?? 8;

  const dadosDisponiveis = Math.max(0, player.nivel - player.dados_vida_gastos);
  if (dadosDisponiveis <= 0) {
    throw new Error(`${player.nome} não tem mais Dados de Vida disponíveis (todos já gastos desde o último Descanso Longo).`);
  }

  const quantidadeReal = Math.max(1, Math.min(quantidade_dados, dadosDisponiveis));
  const modResistencia = calculateModifier(player.resistencia);

  let curaTotal = 0;
  const rolagens = [];
  for (let i = 0; i < quantidadeReal; i++) {
    const dado = rollDice(`1d${dadoVida}`);
    const cura = Math.max(0, dado + modResistencia);
    rolagens.push({ dado, mod: modResistencia, cura });
    curaTotal += cura;
  }

  const hpAntes = player.hp_atual;
  const hpDepois = Math.min(player.hp_maximo, hpAntes + curaTotal);

  gastarDadosDeVida(jogador_id, quantidadeReal);
  updatePlayerHP(jogador_id, hpDepois);

  return {
    tipo: "curto",
    dados_gastos: quantidadeReal,
    dados_restantes: dadosDisponiveis - quantidadeReal,
    rolagens,
    cura_total: hpDepois - hpAntes,
    hp_antes: hpAntes,
    hp_depois: hpDepois,
    hp_maximo: player.hp_maximo,
  };
}

/**
 * Descanso Longo: recupera todo o HP e todos os Dados de Vida gastos.
 * Limitado a uma vez por 24h reais; interrompido se houver inimigos por perto.
 */
export function descansoLongo(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (player.status === "morto") throw new Error(`${player.nome} está morto.`);
  if (player.status === "inconsciente") throw new Error(`${player.nome} está inconsciente e não pode descansar.`);
  if (inimigosPorPerto()) throw new Error("Não é possível descansar com inimigos por perto.");

  const agora = Date.now();
  if (player.ultimo_descanso_longo) {
    const decorrido = agora - player.ultimo_descanso_longo;
    if (decorrido < LIMITE_DESCANSO_LONGO_MS) {
      const faltamMs = LIMITE_DESCANSO_LONGO_MS - decorrido;
      const faltamHoras = Math.ceil(faltamMs / (60 * 60 * 1000));
      throw new Error(`${player.nome} já fez um Descanso Longo nas últimas 24h. Faltam aproximadamente ${faltamHoras}h.`);
    }
  }

  const hpAntes = player.hp_atual;

  updatePlayerHP(jogador_id, player.hp_maximo);
  resetDadosDeVida(jogador_id);
  registrarDescansoLongo(jogador_id, agora);

  return {
    tipo: "longo",
    hp_antes: hpAntes,
    hp_depois: player.hp_maximo,
    hp_maximo: player.hp_maximo,
    dados_vida_restaurados: player.nivel,
  };
}

export function setupRestRoutes(app) {
  app.post("/api/rest/curto", (req, res) => {
    const { jogador_id, quantidade_dados = 1 } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });
    try {
      const resultado = descansoCurto(Number(jogador_id), Number(quantidade_dados) || 1);
      res.json({ sucesso: true, resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  app.post("/api/rest/longo", (req, res) => {
    const { jogador_id } = req.body;
    if (!jogador_id) return res.status(400).json({ sucesso: false, erro: "jogador_id obrigatório." });
    try {
      const resultado = descansoLongo(Number(jogador_id));
      res.json({ sucesso: true, resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[RestEngine] Rotas registradas: /api/rest/*");
}
