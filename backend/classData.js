// ==========================================
// TABELA DE CLASSES JOGÁVEIS — VEXON
// Extraído de Readme.txt (Livro do Jogador)
// ==========================================
// dado_vida: valor máximo do dado de vida no nível 1 (HP = dado_vida + mod Resistência)
// atributos_principais: usados para pré-preencher a tela de criação de personagem
// ca_formula: null = genérica (10 + mod Destreza); senão uma das chaves tratadas
//             em calcularCaClasse abaixo
// ataque_assinatura: só as classes conjuradoras têm — substitui o ataque de arma
//             por um ataque baseado no atributo da classe
// bonus_dano_dado: só Herdeiro Tático e Predador Estelar têm — bônus fixo somado
//             em todo ataque, além da arma equipada
// habilidades_nivel1: só para exibição na ficha/tela de criação, não mecanizadas
//             além do que está em ca_formula/ataque_assinatura/bonus_dano_dado

import { calculateModifier } from "./engine/diceEngine.js";

export const CLASSES = {
  herdeiro_tatico: {
    id: "herdeiro_tatico",
    nome: "Herdeiro Tático",
    dado_vida: 8,
    atributos_principais: ["destreza"],
    ca_formula: null,
    ataque_assinatura: null,
    bonus_dano_dado: "1d6",
    bonus_dano_tipo: "furtivo",
    descricao: "Mestre do combate urbano, do silêncio e da análise tática. Usa a tecnologia, o treinamento brutal e as sombras a seu favor.",
    habilidades_nivel1: [
      { nome: "Visão Tática", descricao: "Bônus: marca um inimigo, concede vantagem no próximo ataque contra ele e revela seu HP." },
      { nome: "Ataque Furtivo", descricao: "+1d6 de dano furtivo (aplicado em todo ataque nesta versão, sem exigir vantagem/aliado adjacente)." },
    ],
  },

  anomalia_bioenergetica: {
    id: "anomalia_bioenergetica",
    nome: "Anomalia Bioenergética",
    dado_vida: 8,
    atributos_principais: ["carisma", "resistencia"],
    ca_formula: null,
    ataque_assinatura: { atributo: "carisma", dado_dano: "1d10", tipo_dano: "energia", nome_habilidade: "Pulso de Quasiluz" },
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Resultado da bioengenharia avançada e nanotecnologia celular; um núcleo bioenergético quântico pulsa em seu centro.",
    habilidades_nivel1: [
      { nome: "Pulso de Quasiluz", descricao: "Ataque à distância (18m), Carisma rege acerto e dano — 1d10+CAR de dano de energia." },
      { nome: "Interface de Defesa Fluida", descricao: "Reação (não modelada nesta versão): +3 CA até o início do próximo turno." },
    ],
  },

  ilusionista_das_sombras: {
    id: "ilusionista_das_sombras",
    nome: "Ilusionista das Sombras",
    dado_vida: 8,
    atributos_principais: ["inteligencia", "destreza"],
    ca_formula: null,
    ataque_assinatura: { atributo: "inteligencia", dado_dano: "1d8", tipo_dano: "necrótico", nome_habilidade: "Lâmina de Sombra / Raio Sombrio" },
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Última linha de defesa da magia real; molda o vazio com o Grimório de Umbros e comanda a escuridão da cidade.",
    habilidades_nivel1: [
      { nome: "Lâmina de Sombra e Raio Sombrio", descricao: "Corpo a corpo ou à distância (18m), Inteligência rege — 1d8+INT dano necrótico/mágico." },
      { nome: "Truques de Salão", descricao: "Ilusões menores sem efeito de combate — puramente narrativo." },
    ],
  },

  arconte: {
    id: "arconte",
    nome: "Arconte",
    dado_vida: 6,
    atributos_principais: ["sabedoria", "resistencia"],
    ca_formula: null,
    ataque_assinatura: { atributo: "sabedoria", dado_dano: "1d10", tipo_dano: "elemental", nome_habilidade: "Sintonização Primordial" },
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Mestre da Magia Ancestral, vestindo as tradicionais vestes vermelhas e máscaras de ferro. Seu corpo é canal para os elementos primordiais.",
    habilidades_nivel1: [
      { nome: "Sintonização Primordial", descricao: "Ataque à distância (18m), Sabedoria rege — 1d10+SAB de dano." },
      { nome: "Escudo de Runas Ancestrais", descricao: "Reação (não modelada nesta versão): +2 CA contra um ataque." },
    ],
  },

  tecno_mago: {
    id: "tecno_mago",
    nome: "Tecno-Mago",
    dado_vida: 6,
    atributos_principais: ["inteligencia", "destreza"],
    ca_formula: null,
    ataque_assinatura: { atributo: "inteligencia", dado_dano: "1d10", tipo_dano: "arcano-digital", nome_habilidade: "Compilador Sintético" },
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Confia na matemática, nos circuitos e na física. Domina a Magia Sintética através de um Deck Arcano — um computador tático de pulso.",
    habilidades_nivel1: [
      { nome: "Compilador Sintético", descricao: "Truques infinitos + slots de magia nível 1 (não modelado nesta versão), Inteligência rege." },
      { nome: "Firewall Dinâmico", descricao: "Reação (não modelada nesta versão): +2 CA sem custo." },
    ],
  },

  hacker_corporativo: {
    id: "hacker_corporativo",
    nome: "Hacker Corporativo",
    dado_vida: 4,
    atributos_principais: ["inteligencia", "sabedoria"],
    ca_formula: "10_int_des_drone",
    ataque_assinatura: null,
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Opera remotamente via um drone de combate; raramente entra em risco físico direto.",
    habilidades_nivel1: [
      { nome: "Presença Remota", descricao: "Age via drone: CA=10+INT+DES, HP=2×nível (pool de drone não modelado nesta versão — usa a CA do jogador)." },
      { nome: "Overwatch Tático", descricao: "Ação de Ajudar à distância (não modelada nesta versão)." },
    ],
  },

  algoz_cibernetico: {
    id: "algoz_cibernetico",
    nome: "Algoz Cibernético",
    dado_vida: 10,
    atributos_principais: ["forca", "resistencia"],
    ca_formula: "13_con",
    ataque_assinatura: null,
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Chassi blindado por implantes de combate pesado, imune a venenos gasosos.",
    habilidades_nivel1: [
      { nome: "Chassi Blindado", descricao: "CA=13+CON, imune a veneno gasoso." },
      { nome: "Ventilação Ativa", descricao: "Bônus: reduz o Medidor de Calor em 3 (recurso não modelado nesta versão)." },
    ],
  },

  bastiao_implacavel: {
    id: "bastiao_implacavel",
    nome: "Bastião Implacável",
    dado_vida: 12,
    atributos_principais: ["resistencia", "forca"],
    ca_formula: null,
    ataque_assinatura: null,
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Tanque dedicado a absorver dano para proteger aliados, sacrificando mobilidade por resiliência.",
    habilidades_nivel1: [
      { nome: "Intervenção de Risco", descricao: "Reação: assume dano de um aliado, ganha 2 Cargas (recurso não modelado nesta versão)." },
      { nome: "Cargas de Sacrifício", descricao: "Passiva: -1m deslocamento, +2 dano corpo a corpo por carga ativa (não modelado nesta versão)." },
    ],
  },

  herdeiro_do_mar: {
    id: "herdeiro_do_mar",
    nome: "Herdeiro do Mar",
    dado_vida: 10,
    atributos_principais: ["forca", "carisma"],
    ca_formula: null,
    ataque_assinatura: null,
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Descendente de uma linhagem aquática ancestral, alterna entre posturas de maré em combate.",
    habilidades_nivel1: [
      { nome: "Sangue de Enki", descricao: "Respira na água, visão no escuro, ignora terreno difícil — sem efeito de combate." },
      { nome: "O Ciclo das Marés", descricao: "Postura Enchente (+3m deslocamento/+1d4 dano frio-impacto/empurra) ou Vazante (+2 CA/atrasa inimigos) — não modelado nesta versão." },
    ],
  },

  herdeiro_de_pedra: {
    id: "herdeiro_de_pedra",
    nome: "Herdeiro de Pedra",
    dado_vida: 10,
    atributos_principais: ["forca", "carisma"],
    ca_formula: "13_con",
    ataque_assinatura: null,
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Herdeiro de uma linhagem de guerreiros de cristal vivo (Osvaryen), pele endurecida como granito.",
    habilidades_nivel1: [
      { nome: "Arsenal de Osvaryen", descricao: "Bônus: invoca arma de cristal (espada/martelo/lança) — não modelado mecanicamente nesta versão além da flavor." },
      { nome: "Pele de Granito", descricao: "CA=13+CON sem armadura." },
    ],
  },

  desperto_vex: {
    id: "desperto_vex",
    nome: "Desperto Vex",
    dado_vida: 8,
    atributos_principais: ["resistencia"],
    ca_formula: null,
    ataque_assinatura: { atributo: "forca", dado_dano: "1d8", tipo_dano: "natural", nome_habilidade: "Golpe Instintivo" },
    bonus_dano_dado: null,
    bonus_dano_tipo: null,
    descricao: "Mutante que despertou poderes latentes de origem desconhecida (Vex).",
    habilidades_nivel1: [
      { nome: "Traço Mutante", descricao: "Escolhe um traço permanente: Físico Aprimorado / Sentidos Predatórios / Biologia Alterada (flavor nesta versão)." },
      { nome: "Golpe Instintivo", descricao: "Ataque natural, 1d8+atributo principal, corpo a corpo ou à distância até 12m." },
    ],
  },

  predador_estelar: {
    id: "predador_estelar",
    nome: "Predador Estelar",
    dado_vida: 10,
    atributos_principais: ["destreza", "sabedoria"],
    ca_formula: "13_des",
    ataque_assinatura: null,
    bonus_dano_dado: "1d6",
    bonus_dano_tipo: "presa-marcada",
    descricao: "Caçador de origem alienígena, rastreia e abate presas com precisão implacável.",
    habilidades_nivel1: [
      { nome: "Biologia Extraterrestre", descricao: "CA=13+DES, não precisa respirar, imune a veneno gasoso." },
      { nome: "O Contrato de Caça", descricao: "+1d6 de dano extra contra a Presa marcada (aplicado em todo ataque nesta versão, sem exigir marcação prévia)." },
    ],
  },
};

export const CLASSE_IDS = Object.keys(CLASSES);

export function getClasse(id) {
  return CLASSES[id] ?? null;
}

/**
 * Calcula a CA de um personagem no momento da criação, usando a fórmula
 * própria da classe (se houver) ou a fórmula genérica (10 + mod Destreza),
 * seguindo o mesmo padrão de calcularCaNpc() em entityHandler.js.
 */
export function calcularCaClasse(classeId, atributos) {
  const c      = getClasse(classeId);
  const modDes = calculateModifier(atributos.destreza ?? 10);

  if (!c || !c.ca_formula) return 10 + modDes;

  switch (c.ca_formula) {
    case "13_con":           return 13 + calculateModifier(atributos.resistencia ?? 10);
    case "13_des":           return 13 + modDes;
    case "10_int_des_drone": return 10 + calculateModifier(atributos.inteligencia ?? 10) + modDes;
    default:                 return 10 + modDes;
  }
}
