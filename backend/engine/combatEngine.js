import {
  getPlayer,
  getActiveEntity,
  updateActiveEntityHP,
  updatePlayerHP,
  getEquippedWeapon,
  addPlayerGold,
  awardPlayerXP,
  logWorldEvent,
  registrarDeathSave,
} from "../db/database.js";
import { calculateModifier } from "./skillEngine.js";
import { getClasse, getBonusDanoDado } from "../classData.js";
import { aplicarDanoEm0HP } from "./deathEngine.js";
import { rollD20ComModo } from "./diceEngine.js";
import { resolverModoAtaque, critAutomaticoPorParalisia, temCondicao } from "./conditionEngine.js";

// ==========================================
// CONSTANTES DE COMBATE
// ==========================================

const DANO_DESARMADO    = "1d4";
const DANO_MONSTRO_BASE = "1d6";
const XP_BASE_POR_NIVEL = 100; // XP por nível do inimigo derrotado
const OURO_MIN          = 5;
const OURO_MAX          = 50;

// ==========================================
// ROLADOR DE DADOS
// ==========================================

/**
 * Rola dados a partir de uma string no formato "XdY+Z" ou "XdY".
 * Exemplos: "2d6", "1d8+3", "3d4"
 * @returns {number} total rolado (sem modificadores externos)
 */
export function rollDiceString(diceString = DANO_DESARMADO) {
  // Normaliza: pega só a parte "XdY", ignora bônus inline (tratados fora)
  const match = String(diceString).toLowerCase().match(/(\d+)d(\d+)/);

  if (!match) {
    // Se a string for só um número fixo (ex: "5"), usa direto
    const fixo = parseInt(diceString);
    return isNaN(fixo) ? rollDiceString(DANO_DESARMADO) : fixo;
  }

  const qtd   = Math.max(1, parseInt(match[1]));
  const faces = Math.max(2, parseInt(match[2]));
  let total   = 0;

  for (let i = 0; i < qtd; i++) {
    total += Math.floor(Math.random() * faces) + 1;
  }
  return total;
}

/**
 * Determina qual modificador de atributo usar baseado no tipo de arma.
 */
function getModAtaque(player, arma) {
  const usaDestreza = arma?.propriedades?.toLowerCase().includes('finesse')
    || arma?.tipo === 'arma_distancia';

  const atributo = usaDestreza ? (player.destreza || 10) : (player.forca || 10);
  return calculateModifier(atributo);
}

/**
 * Calcula as recompensas de um inimigo morto.
 * Usa o nível do inimigo para escalar XP e ouro.
 */
function calcularRecompensas(alvo) {
  const nivel = alvo.nivel || 1;
  const xp    = nivel * XP_BASE_POR_NIVEL;
  const ouro  = Math.floor(Math.random() * (OURO_MAX * nivel - OURO_MIN + 1)) + OURO_MIN;
  const loot  = []; // Futuramente: tabela de loot por tipo/nível

  return { xp, ouro, loot };
}

// ==========================================
// ATAQUE DO JOGADOR
// ==========================================

/**
 * Processa um ataque do jogador contra uma entidade ativa.
 * Retorna um objeto detalhado com o resultado do ataque.
 */
export function calculateAttack(jogador_id, entidade_ativa_id, opcoes = {}) {
  const player = getPlayer(jogador_id);
  const alvo   = getActiveEntity(entidade_ativa_id);
  const arma   = getEquippedWeapon(jogador_id);

  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (!alvo)   throw new Error(`Entidade ${entidade_ativa_id} não encontrada.`);
  if (alvo.status === 'morto') throw new Error(`${alvo.nome_unico} já está morto.`);

  // ---- PERFIL DE CLASSE ----
  // classeInfo é null para jogadores sem classe definida (legado) — nesse caso
  // todo o bloco abaixo colapsa exatamente no comportamento original (arma/desarmado).
  const classeInfo       = player.classe ? getClasse(player.classe) : null;
  let ataqueAssinatura   = classeInfo?.ataque_assinatura ?? null;
  // Silenciado bloqueia magia com componente verbal — o ataque de assinatura
  // (todos mágicos) fica indisponível, cai para arma/desarmado.
  if (ataqueAssinatura && temCondicao({ jogador_id }, 'silenciado')) {
    ataqueAssinatura = null;
  }

  // ---- ACERTO ----
  const alcanceCorpoACorpo = ataqueAssinatura
    ? ataqueAssinatura.alcance !== 'distancia'
    : !(arma?.tipo === 'arma_distancia');
  const modo = resolverModoAtaque({ jogador_id }, { entidade_id: entidade_ativa_id }, { alcanceCorpoACorpo });
  const modAtaque = ataqueAssinatura
    ? calculateModifier(player[ataqueAssinatura.atributo] ?? 10)
    : getModAtaque(player, arma);
  const { resultado: dadoBruto } = rollD20ComModo(modo);
  const naturalCritico = dadoBruto === 20;
  const falhaCritica   = dadoBruto === 1;
  const totalAcerto    = dadoBruto + modAtaque;
  const caAlvo         = (alvo.ca || 10) + (alvo.bonus_ca || 0);
  const acertou        = !falhaCritica && (naturalCritico || totalAcerto >= caAlvo);
  const critico        = acertou && (naturalCritico || critAutomaticoPorParalisia({ entidade_id: entidade_ativa_id }, { alcanceCorpoACorpo }));

  if (!acertou) {
    return {
      acertou:      false,
      critico:      false,
      falha_critica: falhaCritica,
      dado_bruto:   dadoBruto,
      total_acerto: totalAcerto,
      ca_alvo:      caAlvo,
      alvo:         { nome: alvo.nome_unico, hp_atual: alvo.hp_atual },
    };
  }

  // ---- DANO ----
  const stringDano = ataqueAssinatura
    ? ataqueAssinatura.dado_dano
    : (arma?.dano_ou_efeito || DANO_DESARMADO);
  let dadoDano      = rollDiceString(stringDano);

  // Sobrecarga/Foco de Intensidade (Arconte/Anomalia Bioenergética, 1 PE/PS):
  // rerrola o dado de dano do ataque de assinatura se deu 1 ou 2. Readme.txt
  // descreve isso para dados únicos (1d10) — rerrola uma vez, sem exceção.
  if (opcoes.rerrolarDanoBaixo && ataqueAssinatura && dadoDano <= 2) {
    dadoDano = rollDiceString(stringDano);
  }

  // Crítico: rola os dados de dano uma segunda vez (não dobra o total — regra D&D 5e)
  if (critico) dadoDano += rollDiceString(stringDano);

  // Potencializar (Desperto Vex, 1 FV): soma um dado extra ao Golpe Instintivo —
  // aditivo, não substitui nem rerrola o dado base (diferente de rerrolarDanoBaixo).
  const bonusDanoExtra = (opcoes.bonusDanoExtra && ataqueAssinatura)
    ? rollDiceString(opcoes.bonusDanoExtra)
    : 0;

  // Bônus fixo de dano por classe (Herdeiro Tático e Predador Estelar, ambos
  // escalados por nível via getBonusDanoDado) — somado ao dano final, não
  // re-rolado no crítico (é um bônus por golpe, não parte do dado da arma).
  const danoDadoClasse  = getBonusDanoDado(player.classe, player.nivel);
  const bonusDadoClasse = danoDadoClasse ? rollDiceString(danoDadoClasse) : 0;

  const bonusDano   = modAtaque + (alvo.dano_bonus || 0) + (arma ? 0 : 0) + bonusDadoClasse + bonusDanoExtra;
  const danoFinal   = Math.max(1, dadoDano + bonusDano);

  // ---- APLICA DANO ----
  const novoHp      = Math.max(0, alvo.hp_atual - danoFinal);
  const { status: novoStatus } = updateActiveEntityHP(entidade_ativa_id, novoHp);
  const morreu      = novoStatus === 'morto';

  // ---- RECOMPENSAS (se morreu) ----
  let recompensas = null;
  if (morreu) {
    recompensas = calcularRecompensas(alvo);
    addPlayerGold(jogador_id, recompensas.ouro);
    recompensas.evolucao = awardPlayerXP(jogador_id, recompensas.xp);
    logWorldEvent(
      'batalha',
      `${player.nome} derrotou ${alvo.nome_unico} com ${ataqueAssinatura ? ataqueAssinatura.nome_habilidade : (arma?.nome ?? 'soco')}.`,
      [jogador_id, entidade_ativa_id]
    );
  }

  return {
    acertou:      true,
    critico,
    falha_critica: false,
    dado_bruto:   dadoBruto,
    total_acerto: totalAcerto,
    ca_alvo:      caAlvo,
    mod_ataque:   modAtaque,
    dano_bruto:   dadoDano,
    dano_bonus:   bonusDano,
    dano:         danoFinal,
    arma:         ataqueAssinatura ? ataqueAssinatura.nome_habilidade : (arma?.nome ?? 'Soco'),
    tipo_dano:    ataqueAssinatura?.tipo_dano ?? classeInfo?.bonus_dano_tipo ?? "físico",
    habilidade_usada: ataqueAssinatura?.nome_habilidade ?? null,
    alvo: {
      nome:        alvo.nome_unico,
      hp_anterior: alvo.hp_atual,
      hp_restante: novoHp,
      morreu,
    },
    recompensas,
  };
}

// ==========================================
// ATAQUE DO MONSTRO / NPC
// ==========================================

/**
 * Processa um ataque de uma entidade ativa contra o jogador.
 * Usa os atributos e ações da entidade para calcular o ataque.
 */
export function entityAttacksPlayer(entidade_ativa_id, jogador_id) {
  const entidade = getActiveEntity(entidade_ativa_id);
  const player   = getPlayer(jogador_id);

  if (!entidade) throw new Error(`Entidade ${entidade_ativa_id} não encontrada.`);
  if (!player)   throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (entidade.status === 'morto') throw new Error(`${entidade.nome_unico} está morto e não pode atacar.`);
  if (player.status === 'morto') throw new Error(`${player.nome} já está morto.`);

  // ---- PERFIL DE CLASSE (opcional, definido pelo mestre na criação) ----
  // classeInfo é null para entidades sem classe (o padrão até hoje) — nesse
  // caso todo o bloco abaixo colapsa exatamente no comportamento original.
  const classeInfo       = entidade.classe ? getClasse(entidade.classe) : null;
  const ataqueAssinatura = classeInfo?.ataque_assinatura ?? null;

  // ---- ACERTO ----
  const alcanceCorpoACorpo = ataqueAssinatura ? ataqueAssinatura.alcance !== 'distancia' : true;
  const modo = resolverModoAtaque({ entidade_id: entidade_ativa_id }, { jogador_id }, { alcanceCorpoACorpo });
  const modForca    = ataqueAssinatura
    ? calculateModifier(entidade[ataqueAssinatura.atributo] ?? 10)
    : calculateModifier(entidade.forca || 10);
  const { resultado: dadoBruto } = rollD20ComModo(modo);
  const naturalCritico = dadoBruto === 20;
  const falhaCritica   = dadoBruto === 1;
  const totalAcerto = dadoBruto + modForca;
  const caJogador   = player.ca || 10;
  const acertou     = !falhaCritica && (naturalCritico || totalAcerto >= caJogador);
  const critico     = acertou && (naturalCritico || critAutomaticoPorParalisia({ jogador_id }, { alcanceCorpoACorpo }));

  if (!acertou) {
    return {
      acertou:      false,
      critico:      false,
      falha_critica: falhaCritica,
      dado_bruto:   dadoBruto,
      total_acerto: totalAcerto,
      ca_alvo:      caJogador,
      atacante:     { nome: entidade.nome_unico },
      alvo:         { nome: player.nome, hp_atual: player.hp_atual },
    };
  }

  // ---- DANO ----
  // Tenta ler a primeira ação do monstro para pegar o dano definido no compêndio,
  // a menos que a classe tenha um ataque de assinatura que o substitua.
  const acoes        = entidade.acoes ?? [];
  const primeiraAcao = Array.isArray(acoes) ? acoes[0] : null;
  const stringDano   = ataqueAssinatura ? ataqueAssinatura.dado_dano : (primeiraAcao?.dano || DANO_MONSTRO_BASE);

  let dadoDano = rollDiceString(stringDano);
  if (critico) dadoDano += rollDiceString(stringDano);

  // Bônus fixo de dano por classe (Herdeiro Tático escalado por nível, Predador
  // Estelar fixo). Quem ataca aqui é a entidade, não o jogador — usa o nível dela.
  const danoDadoClasse  = getBonusDanoDado(entidade.classe, entidade.nivel);
  const bonusDadoClasse = danoDadoClasse ? rollDiceString(danoDadoClasse) : 0;

  const bonusDano  = modForca + (entidade.bonus_dano || 0) + bonusDadoClasse;
  const danoFinal  = Math.max(1, dadoDano + bonusDano);

  // ---- APLICA DANO AO JOGADOR ----
  const jaEstavaInconsciente = player.status === "inconsciente";

  const novoHp    = Math.max(0, player.hp_atual - danoFinal);
  updatePlayerHP(jogador_id, novoHp);

  // ---- TESTE CONTRA A MORTE (Readme.txt "Caindo a 0 Pontos de Vida") ----
  let caiuInconsciente = false;
  let testeMorte        = null;
  if (jaEstavaInconsciente) {
    testeMorte = aplicarDanoEm0HP(jogador_id, critico);
  } else if (novoHp <= 0) {
    registrarDeathSave(jogador_id, { sucessos: 0, falhas: 0, status: "inconsciente" });
    caiuInconsciente = true;
  }

  const jogadorInconsciente = novoHp <= 0;

  if (caiuInconsciente) {
    logWorldEvent(
      'batalha',
      `${player.nome} foi derrubado por ${entidade.nome_unico}.`,
      [jogador_id, entidade_ativa_id]
    );
  }

  return {
    acertou:      true,
    critico,
    falha_critica: false,
    dado_bruto:   dadoBruto,
    total_acerto: totalAcerto,
    ca_alvo:      caJogador,
    mod_ataque:   modForca,
    dano_bruto:   dadoDano,
    dano_bonus:   bonusDano,
    dano:         danoFinal,
    tipo_dano:    ataqueAssinatura?.tipo_dano ?? classeInfo?.bonus_dano_tipo ?? "físico",
    habilidade_usada: ataqueAssinatura?.nome_habilidade ?? null,
    atacante:     { nome: entidade.nome_unico },
    alvo: {
      nome:              player.nome,
      hp_anterior:       player.hp_atual,
      hp_restante:       novoHp,
      inconsciente:      jogadorInconsciente,
    },
    caiu_inconsciente: caiuInconsciente,
    teste_morte:        testeMorte,
  };
}

// ==========================================
// RODADA COMPLETA DE COMBATE
// ==========================================

/**
 * Processa uma rodada completa: jogador ataca, depois cada inimigo ativo ataca de volta.
 * Útil para o RPG Master chamar em um único passo.
 *
 * @param {number} jogador_id
 * @param {number} entidade_alvo_id  - Entidade que o jogador quer atacar
 * @param {number[]} inimigos_ativos - Todos os IDs de entidades que atacam de volta
 * @returns {{ ataque_jogador, contra_ataques: [] }}
 */
export async function processCombatRound(jogador_id, entidade_alvo_id, inimigos_ativos = []) {
  const ataque_jogador = calculateAttack(jogador_id, entidade_alvo_id);

  const contra_ataques = [];
  for (const inimigo_id of inimigos_ativos) {
    try {
      const resultado = await entityAttacksPlayer(inimigo_id, jogador_id);
      contra_ataques.push(resultado);

      // Se o jogador ficou inconsciente, interrompe os contra-ataques
      const playerAtual = getPlayer(jogador_id);
      if (playerAtual?.hp_atual <= 0) break;
    } catch (err) {
      // Inimigo já morto ou inválido — ignora silenciosamente
      contra_ataques.push({ erro: err.message, inimigo_id });
    }
  }

  return { ataque_jogador, contra_ataques };
}