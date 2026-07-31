import dotenv from "dotenv";
dotenv.config();

import {
  getActiveEntity,
  applyNemesisEvolution,
  logWorldEvent,
  parseJson,
} from "../db/database.js";
import {
  updateEmotionalState,
  addRichMemory,
  criarMemoriaRica,
  getEmotionalContext,
} from "./npcsoulEngine.js";
import { TOM_VEXON } from "../loreVexon.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const TIMEOUT      = 20000;

// ==========================================
// LIMIARES DO SISTEMA NEMESIS
// ==========================================

const LIMIAR_TRAUMA_LEVE        = 0.25;
const LIMIAR_TRAUMA_GRAVE       = 0.60;
const LIMIAR_TRAUMA_QUASE_MORTO = 0.90;

const COOLDOWN_EVOLUCAO_MS = 5 * 60 * 1000;
const _ultimaEvolucao      = new Map();

// ==========================================
// CLIENTE OLLAMA
// ==========================================

async function callOllama(messages, opcoes = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        stream:   false,
        messages,
        options: { temperature: 0.75, top_p: 0.9, num_predict: 250, ...opcoes },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function extrairJson(texto) {
  const limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = limpo.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("Nenhum JSON encontrado na resposta.");
  return JSON.parse(match[0]);
}

// ==========================================
// ANÁLISE DE TRAUMA (local, sem IA)
// ==========================================

function analisarTrauma(monstroAtivo, hpAntesDoCombate, oQueOJogadorFez) {
  const hpMaximo   = monstroAtivo.hp_maximo || 1;
  const hpPerdido  = Math.max(0, hpAntesDoCombate - (monstroAtivo.hp_atual ?? 0));
  const percentual = hpPerdido / hpMaximo;

  let nivelTrauma, descricaoTrauma;

  if (percentual >= LIMIAR_TRAUMA_QUASE_MORTO) {
    nivelTrauma     = "quase_morto";
    descricaoTrauma = "Chegou à beira da morte — sequelas físicas permanentes são prováveis (amputação, cegueira, cicatrizes severas).";
  } else if (percentual >= LIMIAR_TRAUMA_GRAVE) {
    nivelTrauma     = "grave";
    descricaoTrauma = "Ferimentos sérios — pode ter ficado mais cauteloso, raivoso ou buscou reforços.";
  } else if (percentual >= LIMIAR_TRAUMA_LEVE) {
    nivelTrauma     = "leve";
    descricaoTrauma = "Saiu ferido mas funcional — provavelmente treinou ou adaptou sua tática.";
  } else {
    nivelTrauma     = "minimo";
    descricaoTrauma = "Quase ileso — ficou com raiva e vai com mais agressividade.";
  }

  const contextos = [
    /fogo|chama|queimar|incêndio/i.test(oQueOJogadorFez)      && "Usou fogo — possível fobia ou resistência a chamas.",
    /gelo|frio|congelar|blizzard/i.test(oQueOJogadorFez)      && "Usou gelo — possível aversão ao frio.",
    /veneno|tóxico|envenenar/i.test(oQueOJogadorFez)           && "Usou veneno — possível imunidade parcial adquirida.",
    /furtiv|costas|emboscada|surpresa/i.test(oQueOJogadorFez)  && "Ataque pelas costas — agora é paranóico.",
    /humilh|chacota|zombar|provocar/i.test(oQueOJogadorFez)    && "Jogador humilhou — ódio pessoal intensificado.",
  ].filter(Boolean).join(" ");

  return { nivelTrauma, descricaoTrauma, percentual, contextos };
}

function calcularRanges(nivelTrauma) {
  const RANGES = {
    quase_morto: { hp: [-20, 10], ca: [-2, 1], dano: [-2, 3] },
    grave:       { hp: [-10, 15], ca: [-1, 2], dano: [-1, 3] },
    leve:        { hp: [-5,  20], ca: [0,  2], dano: [0,  2] },
    minimo:      { hp: [5,   25], ca: [0,  2], dano: [1,  3] },
  };
  return RANGES[nivelTrauma] ?? RANGES.leve;
}

// ==========================================
// GERAÇÃO COM OLLAMA (enriquecida com alma)
// ==========================================

async function gerarEvolucaoComIA(monstroAtivo, oQueOJogadorFez, analise, ranges) {
  const { nivelTrauma, descricaoTrauma, contextos } = analise;
  const { hp, ca, dano } = ranges;

  const historicoTexto = monstroAtivo.historico_consequencias?.trim()
    || "Nenhum encontro anterior registrado.";

  // Enriquece o prompt com a alma emocional atual da entidade
  // Isso faz a personalidade pós-trauma ser coerente com quem ela já era por dentro
  const ctxEmocional  = getEmotionalContext(monstroAtivo.id, "entidades_vivas");
  const blocoAlma     = ctxEmocional?.resumo_prompt
    ? `\nVida interior atual da entidade:\n${ctxEmocional.resumo_prompt}`
    : "";

  const system = `${TOM_VEXON}

Você é o arquiteto do destino de Vexon. Crie evoluções Nemesis realistas e dramáticas para entidades que sobreviveram a combates.
A nova personalidade deve ser uma continuação orgânica da vida interior já existente — não uma reinvenção completa.
Responda APENAS com JSON válido. Sem texto antes ou depois.`;

  const user = `Entidade: ${monstroAtivo.nome_unico}
Personalidade atual: ${monstroAtivo.nova_personalidade || monstroAtivo.personalidade || "Desconhecida"}
HP atual/máximo: ${monstroAtivo.hp_atual}/${monstroAtivo.hp_maximo}
Histórico Nemesis: ${historicoTexto}
${blocoAlma}

O que o jogador fez: "${oQueOJogadorFez}"
Nível de trauma: ${nivelTrauma} — ${descricaoTrauma}
${contextos ? `Contexto especial: ${contextos}` : ""}

Ranges obrigatórios:
- alteracao_hp_maximo: entre ${hp[0]} e ${hp[1]}
- alteracao_bonus_ca:  entre ${ca[0]} e ${ca[1]}
- alteracao_bonus_dano: entre ${dano[0]} e ${dano[1]}

JSON obrigatório:
{
  "novo_nome": "Nome com título dramático baseado no trauma (ex: Kael, o Queimado)",
  "novo_historico": "1-2 frases sobre aparência atual e sequelas visíveis",
  "nova_personalidade": "Como a mente mudou — fobia, paranoia, sadismo, etc. Deve ser coerente com a vida interior já existente.",
  "alteracao_hp_maximo": número dentro do range,
  "alteracao_bonus_ca": número dentro do range,
  "alteracao_bonus_dano": número dentro do range
}`;

  const raw = await callOllama([
    { role: "system", content: system },
    { role: "user",   content: user   },
  ]);
  return extrairJson(raw);
}

function sanitizarEvolucao(evolucao, ranges) {
  const clamp = (val, min, max) =>
    Math.max(min, Math.min(max, Math.round(Number(val) || 0)));

  return {
    novo_nome:            String(evolucao.novo_nome          || "O Marcado").slice(0, 80),
    novo_historico:       String(evolucao.novo_historico     || "").slice(0, 400),
    nova_personalidade:   String(evolucao.nova_personalidade || "").slice(0, 400),
    alteracao_hp_maximo:  clamp(evolucao.alteracao_hp_maximo,  ranges.hp[0],   ranges.hp[1]),
    alteracao_bonus_ca:   clamp(evolucao.alteracao_bonus_ca,   ranges.ca[0],   ranges.ca[1]),
    alteracao_bonus_dano: clamp(evolucao.alteracao_bonus_dano, ranges.dano[0], ranges.dano[1]),
  };
}

function gerarEvolucaoFallback(monstroAtivo, nivelTrauma) {
  const SUFIXOS = {
    quase_morto: ["o Mutilado",  "o Quebrado",   "Meia-Morte",    "o Aleijado"  ],
    grave:       ["o Ferido",    "o Cicatriz",    "o Vingativo",   "o Resistente"],
    leve:        ["o Marcado",   "o Obstinado",   "o Rancoroso",   "o Persistente"],
    minimo:      ["o Furioso",   "o Afiado",      "o Impaciente",  "o Incansável"],
  };

  const lista  = SUFIXOS[nivelTrauma] ?? SUFIXOS.leve;
  const sufixo = lista[Math.floor(Math.random() * lista.length)];
  const base   = monstroAtivo.nome_unico.split(",")[0].trim();

  return {
    novo_nome:            `${base}, ${sufixo}`,
    novo_historico:       `Sobreviveu ao encontro. Cicatrizes visíveis contam a história. Os olhos revelam algo diferente agora.`,
    nova_personalidade:   `Mais cauteloso e calculista. Não esquece, não perdoa.`,
    alteracao_hp_maximo:  nivelTrauma === "quase_morto" ? -5 : 5,
    alteracao_bonus_ca:   0,
    alteracao_bonus_dano: 1,
  };
}

// ==========================================
// ATUALIZAÇÃO EMOCIONAL PÓS-NEMESIS
// ==========================================

/**
 * Aplica os deltas emocionais na alma da entidade baseado no nível de trauma.
 * Cria uma memória rica do encontro que persiste para sempre.
 * Chamado após applyNemesisEvolution ter sucesso.
 */
function aplicarImpactoEmocional(monstroAtivo, oQueOJogadorFez, analise) {
  const { nivelTrauma, percentual } = analise;

  // Escala a intensidade emocional com o trauma
  const intensidade = nivelTrauma === "quase_morto" ? 9
                    : nivelTrauma === "grave"        ? 7
                    : nivelTrauma === "leve"         ? 5
                    : 3;

  // Deltas emocionais: quanto mais grave o trauma, mais medo e raiva acumulam
  updateEmotionalState(monstroAtivo.id, {
    emocoes: {
      medo:      +Math.floor(intensidade * 0.7),
      raiva:     +intensidade,
      esperanca: -Math.floor(intensidade * 0.4),
      desconfianca: +Math.floor(intensidade * 0.5),
    },
    // Humor vira paranóico em traumas graves, hostil nos leves
    humor_geral: intensidade >= 7 ? "paranóico" : "hostil",
  }, "entidades_vivas");

  // Memória rica do encontro — intensidade > 7 nunca é esquecida
  addRichMemory(
    monstroAtivo.id,
    criarMemoriaRica(
      "trauma",
      `Quase fui destruído. Cada detalhe está gravado: ${oQueOJogadorFez}. Eu vou voltar diferente.`,
      intensidade,
      ["jogador"]
    ),
    "entidades_vivas"
  );

  // Trauma quase-mortal cria também uma memória de humilhação separada
  if (nivelTrauma === "quase_morto") {
    addRichMemory(
      monstroAtivo.id,
      criarMemoriaRica(
        "humilhacao",
        `Estive à beira do fim. A fraqueza que senti naquele momento não sai da memória.`,
        8,
        ["jogador"]
      ),
      "entidades_vivas"
    );
  }
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

export async function evolveSurvivingMonster(monstroAtivo, oQueOJogadorFez, hpAntesDoCombate = null) {
  if (!monstroAtivo) throw new Error("Entidade não fornecida para o Sistema Nemesis.");

  const hpRef  = hpAntesDoCombate ?? monstroAtivo.hp_maximo;
  const agora  = Date.now();
  const ultima = _ultimaEvolucao.get(monstroAtivo.id) ?? 0;

  if (agora - ultima < COOLDOWN_EVOLUCAO_MS) {
    console.log(`[Nemesis] Cooldown ativo para "${monstroAtivo.nome_unico}". Ignorado.`);
    return null;
  }

  const analise = analisarTrauma(monstroAtivo, hpRef, oQueOJogadorFez);
  const ranges  = calcularRanges(analise.nivelTrauma);

  console.log(`[Nemesis] "${monstroAtivo.nome_unico}" — Trauma: ${analise.nivelTrauma} (${Math.round(analise.percentual * 100)}% HP perdido)`);

  // ---- GERAÇÃO DA EVOLUÇÃO (stats + nome + personalidade) ----
  let evolucao;
  try {
    const raw = await gerarEvolucaoComIA(monstroAtivo, oQueOJogadorFez, analise, ranges);
    evolucao  = sanitizarEvolucao(raw, ranges);
  } catch (err) {
    console.warn(`[Nemesis] Ollama falhou: ${err.message}. Usando fallback.`);
    evolucao = gerarEvolucaoFallback(monstroAtivo, analise.nivelTrauma);
  }

  // ---- APLICA EVOLUÇÃO NO BANCO ----
  try {
    applyNemesisEvolution(monstroAtivo.id, evolucao);
  } catch (err) {
    console.error("[Nemesis] Falha ao aplicar no banco:", err.message);
    return null;
  }

  // ---- APLICA IMPACTO EMOCIONAL NA ALMA ----
  // Feito após a evolução de stats para não bloquear se falhar
  try {
    aplicarImpactoEmocional(monstroAtivo, oQueOJogadorFez, analise);
  } catch (err) {
    console.warn(`[Nemesis] Impacto emocional falhou para ${monstroAtivo.id}: ${err.message}`);
  }

  _ultimaEvolucao.set(monstroAtivo.id, agora);

  logWorldEvent(
    "nemesis",
    `"${monstroAtivo.nome_unico}" evoluiu para "${evolucao.novo_nome}". Trauma: ${analise.nivelTrauma}.`,
    [monstroAtivo.id]
  );

  return {
    entidade_id:     monstroAtivo.id,
    nome_anterior:   monstroAtivo.nome_unico,
    nivel_trauma:    analise.nivelTrauma,
    percentual_dano: Math.round(analise.percentual * 100),
    ...evolucao,
  };
}

// ==========================================
// WRAPPER POR ID
// ==========================================

export async function evolveSurvivingMonsterById(entidade_ativa_id, oQueOJogadorFez, hpAntesDoCombate = null) {
  const entidade = getActiveEntity(entidade_ativa_id);
  if (!entidade) throw new Error(`Entidade ${entidade_ativa_id} não encontrada.`);
  return evolveSurvivingMonster(entidade, oQueOJogadorFez, hpAntesDoCombate);
}

// ==========================================
// VERIFICADOR DE GATILHO
// ==========================================

export function shouldTriggerNemesis(entidade, hpAntesDoCombate) {
  if (!["fugiu", "vivo"].includes(entidade.status)) return false;
  const perdido    = Math.max(0, hpAntesDoCombate - (entidade.hp_atual ?? 0));
  const percentual = perdido / (entidade.hp_maximo || 1);
  return percentual >= LIMIAR_TRAUMA_LEVE;
}

// ==========================================
// HISTÓRICO NEMESIS
// ==========================================

export function getNemesisHistory(entidade) {
  const historico = entidade.historico_consequencias;
  if (!historico?.trim()) {
    return `${entidade.nome_unico} ainda não passou por nenhuma evolução Nemesis.`;
  }
  return historico;
}