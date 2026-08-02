import { getPlayer, logWorldEvent } from "../db/database.js";
import { rollDetailed, rollVantagem, rollDesvantagem, rollD20ComModo, calculateModifier } from "./diceEngine.js";
import { getClasse } from "../classData.js";
import { falhaAutomaticaResistencia } from "./conditionEngine.js";

// ==========================================
// MAPA DE PERÍCIAS → ATRIBUTO BASE
// ==========================================
// As 14 perícias oficiais do Vexon, conforme Readme.txt, seção
// "Lista Oficial de Perícia" — não é a lista de D&D 5e (que tinha
// perícias inexistentes no livro, como arcana/natureza/religião, e
// classificava Medicina sob Sabedoria em vez de Inteligência).

export const PERICIAS = {
  // Força
  atletismo:        "forca",

  // Destreza
  acrobacia:        "destreza",
  furtividade:      "destreza",
  prestidigitacao:  "destreza",

  // Inteligência
  investigacao:     "inteligencia",
  medicina:         "inteligencia",
  tecnologia:       "inteligencia",
  historia:         "inteligencia",

  // Sabedoria
  percepcao:        "sabedoria",
  intuicao:         "sabedoria",
  sobrevivencia:    "sabedoria",

  // Carisma
  intimidacao:      "carisma",
  persuasao:        "carisma",
  enganacao:        "carisma",
};

// Atributos válidos do banco
const ATRIBUTOS_VALIDOS = new Set([
  "forca", "destreza", "resistencia", "inteligencia", "sabedoria", "carisma"
]);

// ==========================================
// NÍVEIS DE DIFICULDADE (DC) PADRÃO
// ==========================================
export const DC = {
  trivial:      5,
  facil:        8,
  medio:        12,
  dificil:      15,
  muito_dificil: 18,
  quase_impossivel: 22,
  lendario:     28,
};

// Bônus de proficiência por nível do personagem (D&D 5e)
const BONUS_PROFICIENCIA = [
  0,  // nível 0 (não usado)
  2,  // 1–4
  2,
  2,
  2,
  3,  // 5–8
  3,
  3,
  3,
  4,  // 9–12
  4,
  4,
  4,
  5,  // 13–16
  5,
  5,
  5,
  6,  // 17–20
  6,
  6,
  6,
];

// ==========================================
// HELPERS
// ==========================================

/**
 * Calcula o modificador padrão D&D 5e.
 * Reexportado para compatibilidade com outros módulos.
 */
export { calculateModifier };
export const getModifier = calculateModifier;

/**
 * Retorna o bônus de proficiência para um determinado nível.
 */
export function getBonusProficiencia(nivel = 1) {
  const idx = Math.max(1, Math.min(nivel, BONUS_PROFICIENCIA.length - 1));
  return BONUS_PROFICIENCIA[idx];
}

/**
 * Resolve qual atributo usar para um teste.
 * Aceita tanto nomes de atributo direto ("forca") quanto de perícia ("atletismo").
 * Lança erro se não reconhecer nenhum dos dois.
 */
function normalizarChave(texto) {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function resolverAtributo(nomeOuPericia) {
  const chave = normalizarChave(nomeOuPericia);

  if (ATRIBUTOS_VALIDOS.has(chave)) return chave;

  // Tenta encontrar a perícia pelo nome normalizado
  for (const [pericia, atributo] of Object.entries(PERICIAS)) {
    if (normalizarChave(pericia) === chave) return atributo;
  }

  throw new Error(`Atributo ou perícia desconhecida: "${nomeOuPericia}".`);
}

/**
 * Resolve a chave canônica da perícia (ex.: "furtividade") a partir de um
 * nome livre, ou null se o argumento for um atributo puro (ex.: "forca")
 * em vez de uma perícia. Usado só para achar o bônus fixo de classe abaixo
 * — não interfere em resolverAtributo.
 */
function resolverNomePericia(nomeOuPericia) {
  const chave = normalizarChave(nomeOuPericia);
  if (ATRIBUTOS_VALIDOS.has(chave)) return null;
  for (const pericia of Object.keys(PERICIAS)) {
    if (normalizarChave(pericia) === chave) return pericia;
  }
  return null;
}

/**
 * Bônus fixo de perícia inicial por classe (Readme.txt — "foco tático"),
 * diferente do bônus de proficiência por nível do D&D. Não escala com
 * nível, não se acumula com bonus_proficiencia — é um número fixo definido
 * na criação do personagem, lido de classData.js.
 */
function getBonusClassePericia(classeId, periciaKey) {
  if (!classeId || !periciaKey) return 0;
  const classe = getClasse(classeId);
  const entry  = classe?.pericias_iniciais?.find(p => p.pericia === periciaKey);
  return entry?.bonus ?? 0;
}

// ==========================================
// TESTE DE ATRIBUTO / PERÍCIA (NÚCLEO)
// ==========================================

/**
 * Rola um teste de atributo ou perícia contra uma DC.
 *
 * @param {number} jogador_id
 * @param {string} atributoOuPericia  - Ex: "forca", "furtividade", "percepcao"
 * @param {number} dc                 - Classe de dificuldade
 * @param {object} opcoes
 * @param {boolean} opcoes.proficiente   - Se tem proficiência na perícia
 * @param {boolean} opcoes.expertise     - Se tem expertise (dobra proficiência)
 * @param {'normal'|'vantagem'|'desvantagem'} opcoes.modo
 * @returns {object} Resultado detalhado do teste
 */
export function rollD20Test(jogador_id, atributoOuPericia, dc = DC.medio, opcoes = {}) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);

  const atributo      = resolverAtributo(atributoOuPericia);
  const valorAtributo = player[atributo] ?? 10;
  const modificador   = calculateModifier(valorAtributo);

  // Bônus de proficiência
  const bonusProf = getBonusProficiencia(player.nivel || 1);
  const bonusExtra = opcoes.expertise    ? bonusProf * 2
                   : opcoes.proficiente  ? bonusProf
                   : 0;

  // Bônus fixo de perícia inicial por classe (independente de nível/proficiência)
  const periciaKey = resolverNomePericia(atributoOuPericia);
  const bonusClasse = getBonusClassePericia(player.classe, periciaKey);

  // Rola d20 com modo (normal / vantagem / desvantagem)
  const modo = opcoes.modo ?? "normal";
  const { resultado: dado_bruto, rolagens } = rollD20ComModo(modo);

  const total        = dado_bruto + modificador + bonusExtra + bonusClasse;
  const falhaCritica = dado_bruto === 1;
  const critico       = dado_bruto === 20;
  // Falha automática (ex.: Cego em teste visual, Atordoado/Paralisado em
  // resistência FOR/DES) força sucesso:false incondicionalmente — a rolagem
  // ainda acontece (log/flavor), sem exceção para 20 natural, já que o
  // texto do livro não menciona uma.
  const sucesso = opcoes.falha_automatica
    ? false
    : dado_bruto !== 1 && (dado_bruto === 20 || total >= dc);

  return {
    atributo:      atributo.toUpperCase(),
    pericia:       atributoOuPericia !== atributo ? atributoOuPericia : null,
    dado_bruto,
    rolagens,
    modificador,
    bonus_proficiencia: bonusExtra,
    bonus_classe: bonusClasse,
    total,
    dc,
    sucesso,
    critico,
    falha_critica: falhaCritica,
    falha_automatica: !!opcoes.falha_automatica,
    modo,
    margem:        total - dc, // positivo = passou por quanto, negativo = falhou por quanto
  };
}

// ==========================================
// TESTES ESPECIALIZADOS
// ==========================================

/**
 * Teste de salvaguarda — resistir a um efeito (veneno, magia, armadilha...).
 * Igual ao rollD20Test mas com proficiência automática em salvaguardas do personagem.
 * Atordoado/Paralisado forçam falha automática em salvaguardas de Força/Destreza
 * (Readme.txt, Glossário de Condições).
 * NOTA: sem chamador em nenhum lugar do código hoje — infraestrutura pronta,
 * como outras peças desta sessão (ex.: estabilizarAliado).
 */
export function rollSalvaguarda(jogador_id, atributo, dc = DC.medio, modo = "normal") {
  if (falhaAutomaticaResistencia({ jogador_id }, atributo)) {
    return rollD20Test(jogador_id, atributo, dc, { proficiente: true, falha_automatica: true });
  }
  return rollD20Test(jogador_id, atributo, dc, { modo, proficiente: true });
}

/**
 * Teste de furtividade contra a Percepção Passiva de um oponente.
 * Retorna se o jogador passou despercebido.
 */
export function rollFurtividade(jogador_id, percepcao_passiva_inimigo) {
  const resultado = rollD20Test(jogador_id, "furtividade", percepcao_passiva_inimigo);
  return {
    ...resultado,
    passou_despercebido: resultado.sucesso,
  };
}

/**
 * Teste de iniciativa — determina a ordem de ação no combate.
 * Usa Destreza, sem DC (apenas o valor total importa para ordenação).
 */
export function rollIniciativa(jogador_id) {
  const player   = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  const mod      = calculateModifier(player.destreza || 10);
  const { total: dado } = rollDetailed("1d20");
  return {
    jogador_id,
    nome:      player.nome,
    dado,
    modificador: mod,
    total:     dado + mod,
  };
}

/**
 * Rola iniciativa para um grupo de IDs e retorna ordenado (maior vai primeiro).
 * @param {number[]} ids - jogador_id ou entidade_ativa_id
 */
export function rollGroupInitiative(ids) {
  return ids
    .map(id => rollIniciativa(id))
    .sort((a, b) => b.total - a.total);
}

// ==========================================
// PERCEPÇÃO PASSIVA E INVESTIGAÇÃO PASSIVA
// ==========================================

/**
 * Percepção Passiva = 10 + modificador de Sabedoria.
 * Usada para detectar ameaças sem rolar dados.
 */
export function getPassivePerception(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) return 10;
  return 10 + calculateModifier(player.sabedoria ?? 10);
}

/**
 * Investigação Passiva = 10 + modificador de Inteligência.
 * Usada para notar pistas sem busca ativa.
 */
export function getPassiveInvestigation(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) return 10;
  return 10 + calculateModifier(player.inteligencia ?? 10);
}

// ==========================================
// TESTES DE CONFRONTO (DOIS LADOS ROLAM)
// ==========================================

/**
 * Confronto entre jogador e entidade — cada lado rola e o maior vence.
 * Útil para: furtividade vs percepção, persuasão vs vontade, atletismo vs atletismo.
 *
 * @param {number} jogador_id
 * @param {string} pericias_jogador    - Ex: "furtividade"
 * @param {object} entidade            - Objeto da entidade com atributos
 * @param {string} pericia_entidade    - Ex: "percepcao"
 * @returns {{ vencedor: 'jogador'|'entidade', resultado_jogador, resultado_entidade }}
 */
export function rollConfronto(jogador_id, pericia_jogador, entidade, pericia_entidade) {
  const resultadoJogador = rollD20Test(jogador_id, pericia_jogador, 0); // DC 0 = apenas o total importa

  // Calcula o lado da entidade manualmente
  const atributoEnt = resolverAtributo(pericia_entidade);
  const modEnt      = calculateModifier(entidade[atributoEnt] ?? 10);
  const { total: dadoEnt } = rollDetailed("1d20");
  const totalEnt    = dadoEnt + modEnt;

  const vencedor = resultadoJogador.total >= totalEnt ? "jogador" : "entidade";

  return {
    vencedor,
    resultado_jogador: resultadoJogador,
    resultado_entidade: {
      atributo:   atributoEnt.toUpperCase(),
      dado_bruto: dadoEnt,
      modificador: modEnt,
      total:      totalEnt,
    },
  };
}

// ==========================================
// CHECAGEM DE MORAL (para entidades)
// ==========================================

/**
 * Verifica se uma entidade mantém o moral ou foge/rende-se.
 * Usado pelo entityTurnEngine quando o HP fica crítico.
 *
 * @param {object} entidade  - Entidade ativa com atributos
 * @param {number} dc        - Dificuldade do teste de moral
 * @returns {{ manteve: boolean, total: number, dado: number }}
 */
export function rollMoral(entidade, dc = DC.medio) {
  const modSab  = calculateModifier(entidade.sabedoria ?? 10);
  const modCar  = calculateModifier(entidade.carisma   ?? 10);
  const { total: dado } = rollDetailed("1d20");
  const total   = dado + Math.max(modSab, modCar); // usa o melhor entre Sab e Car
  return {
    manteve: total >= dc,
    total,
    dado,
    dc,
  };
}

// ==========================================
// RESUMO DE FICHA (para o prompt do Ollama)
// ==========================================

/**
 * Retorna um resumo textual dos atributos do jogador.
 * Útil para injetar no system prompt do RPG Master.
 */
export function getPlayerStatSummary(jogador_id) {
  const player = getPlayer(jogador_id);
  if (!player) return "";

  const atrs = ["forca","destreza","resistencia","inteligencia","sabedoria","carisma"];
  const linha = atrs
    .map(a => {
      const val = player[a] ?? 10;
      const mod = calculateModifier(val);
      return `${a.slice(0,3).toUpperCase()} ${val}(${mod >= 0 ? "+" : ""}${mod})`;
    })
    .join(" | ");

  return `${player.nome} Nv.${player.nivel} — ${linha} — HP ${player.hp_atual}/${player.hp_maximo} CA ${player.ca}`;
}