import {
  getActiveEntity,
  getPlayer,
  updatePlayerHP,
  applyNemesisEvolution,
  updateActiveEntityHP,
  logWorldEvent,
  registrarDeathSave,
} from "../db/database.js";
import { rollDice, rollDetailed, calculateModifier } from "./diceEngine.js";
import { getEmotionalContext, updateEmotionalState, addRichMemory, criarMemoriaRica } from "../ia/npcsoulEngine.js";
import { getClasse } from "../classData.js";
import { TOM_VEXON } from "../loreVexon.js";
import { aplicarDanoEm0HP } from "./deathEngine.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";

const DECISOES_VALIDAS = ["atacar", "fugir", "dialogar", "render"];

const DECISAO_FALLBACK = {
  decisao:    "atacar",
  pensamento: "Instinto puro. Destruir o invasor.",
};

// ==========================================
// CLIENTE OLLAMA
// ==========================================

async function callOllama(messages, timeout = 15000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        messages,
        stream:   false,
        options: {
          temperature: 0.75,
          top_p:       0.9,
          num_predict: 200,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function parseDecisao(raw) {
  const limpo = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = limpo.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("Nenhum JSON encontrado na resposta.");

  const parsed  = JSON.parse(match[0]);
  const decisao = String(parsed.decisao || "").toLowerCase().trim();

  if (!DECISOES_VALIDAS.includes(decisao)) {
    throw new Error(`Decisão inválida: "${decisao}".`);
  }

  return {
    decisao,
    pensamento: String(parsed.pensamento || "...").slice(0, 300),
  };
}

// ==========================================
// PROMPT BUILDER (com alma integrada)
// ==========================================

function buildPrompt(entidade, player) {
  const tipoLabel     = entidade.tipo_entidade === "npc" ? "NPC" : "monstro";
  const personalidade = entidade.nova_personalidade || entidade.personalidade || "Agressivo e focado em sobrevivência.";
  const hpPercent     = Math.round((entidade.hp_atual / entidade.hp_maximo) * 100);
  const hpEstado      = hpPercent > 60 ? "saudável" : hpPercent > 25 ? "ferido" : "gravemente ferido";

  // ---- ALMA EMOCIONAL ----
  // Detecta tabela correta e busca o contexto emocional
  const tabela       = entidade.tipo_entidade === "npc" ? "npcs" : "entidades_vivas";
  const ctxEmocional = getEmotionalContext(entidade.id, tabela);

  // Bloco de vida interior — injeta traumas, medos, emoções ativas
  const blocoAlma = ctxEmocional?.resumo_prompt
    ? `\nSua vida interior:\n${ctxEmocional.resumo_prompt}`
    : "";

  // Relação enriquecida (ex: "hostilidade crescente" em vez de "Agressivo")
  const descricaoRelacao = ctxEmocional?.descricao_relacao
    ?? entidade.relacao_com_jogador
    ?? "Desconhecido";

  // Emoção dominante pode forçar decisão mais coerente
  const emocaoDominante = ctxEmocional?.emocao_dominante ?? null;
  const dicaEmocional   = emocaoDominante === "medo" && (ctxEmocional?.intensidade_emocao ?? 0) >= 7
    ? "\nATENÇÃO: Você está com medo extremo. Fuga ou rendição são opções muito válidas agora."
    : emocaoDominante === "raiva" && (ctxEmocional?.intensidade_emocao ?? 0) >= 7
    ? "\nATENÇÃO: Você está tomado pela raiva. Atacar com ferocidade é sua inclinação natural agora."
    : "";
  // -------------------------

  const system = `${TOM_VEXON}
Você controla a mente de um ${tipoLabel} nesse universo.
Responda SOMENTE com um objeto JSON válido. Nenhum texto antes ou depois.
Formato obrigatório: { "decisao": string, "pensamento": string }
Decisões possíveis: "atacar", "fugir", "dialogar", "render"`;

  const user = `Entidade: ${entidade.nome_unico}
Personalidade: ${personalidade}
Estado: ${hpEstado} (${entidade.hp_atual}/${entidade.hp_maximo} HP)
Bônus de dano acumulado (Nemesis): +${entidade.bonus_dano || 0}
Histórico: ${entidade.historico_consequencias || "Nenhum encontro anterior."}
${blocoAlma}
${dicaEmocional}
Jogador: ${player.nome} (Nível ${player.nivel}, ${player.hp_atual}/${player.hp_maximo} HP)
Relação com o jogador: ${descricaoRelacao}
Objetivo: ${entidade.objetivo || "Sobreviver"}

O jogador acabou de atacar você. Decida sua reação considerando tudo acima.
Responda em JSON:`;

  return [
    { role: "system", content: system },
    { role: "user",   content: user   },
  ];
}

// ==========================================
// EXECUTOR DAS DECISÕES
// ==========================================

function executarAtaque(entidade, player, jogador_id) {
  // ---- PERFIL DE CLASSE (opcional, definido pelo mestre na criação) ----
  // classeInfo é null para entidades sem classe (o padrão até hoje) — nesse
  // caso todo o bloco abaixo colapsa exatamente no comportamento original.
  const classeInfo       = entidade.classe ? getClasse(entidade.classe) : null;
  const ataqueAssinatura = classeInfo?.ataque_assinatura ?? null;

  const modAtaque = ataqueAssinatura
    ? calculateModifier(entidade[ataqueAssinatura.atributo] ?? 10)
    : calculateModifier(entidade.forca || 10);
  const d20          = rollDetailed("1d20");
  const dadoBruto    = d20.total;
  const caJogador    = player.ca || 10;
  const critico      = dadoBruto === 20;
  const falhaCritica = dadoBruto === 1;
  const acertou      = !falhaCritica && (critico || (dadoBruto + modAtaque) >= caJogador);

  let dano              = 0;
  let hpJogadorRestante = player.hp_atual;
  let tipoDano          = null;
  let habilidadeUsada   = null;
  let caiuInconsciente  = false;
  let testeMorte        = null;

  if (acertou) {
    const acoes      = Array.isArray(entidade.acoes) ? entidade.acoes : [];
    const stringDano = ataqueAssinatura ? ataqueAssinatura.dado_dano : (acoes[0]?.dano || "1d6");
    let dadoDano     = rollDetailed(stringDano).total;
    if (critico) dadoDano += rollDice(stringDano);

    // Bônus fixo de dano por classe (Herdeiro Tático, Predador Estelar) — somado
    // ao dano final, não re-rolado no crítico (bônus por golpe, não dado base).
    const bonusDadoClasse = classeInfo?.bonus_dano_dado ? rollDice(classeInfo.bonus_dano_dado) : 0;

    dano              = Math.max(1, dadoDano + modAtaque + (entidade.bonus_dano || 0) + bonusDadoClasse);

    // ---- TESTE CONTRA A MORTE (Readme.txt "Caindo a 0 Pontos de Vida") ----
    // player.status reflete o estado ANTES deste golpe (foi lido no início do turno).
    const jaEstavaInconsciente = player.status === "inconsciente";

    hpJogadorRestante = Math.max(0, player.hp_atual - dano);
    updatePlayerHP(jogador_id, hpJogadorRestante);

    if (jaEstavaInconsciente) {
      // Já estava a 0 HP: sofrer dano de novo conta como falha automática
      // (2 falhas se o golpe foi crítico) — não rola dado nenhum.
      testeMorte = aplicarDanoEm0HP(jogador_id, critico);
    } else if (hpJogadorRestante <= 0) {
      // Caiu a 0 HP agora pela primeira vez — fica inconsciente, zera a contagem.
      registrarDeathSave(jogador_id, { sucessos: 0, falhas: 0, status: "inconsciente" });
      caiuInconsciente = true;
    }

    tipoDano        = ataqueAssinatura?.tipo_dano ?? classeInfo?.bonus_dano_tipo ?? "físico";
    habilidadeUsada = ataqueAssinatura?.nome_habilidade ?? null;
  }

  // ---- ALMA: raiva sobe após atacar, esperança oscila ----
  try {
    const tabela = entidade.tipo_entidade === "npc" ? "npcs" : "entidades_vivas";
    updateEmotionalState(entidade.id, {
      emocoes: {
        raiva:     acertou ? +1 : -1,  // errar frustra
        esperanca: acertou ? +1 : 0,
      },
    }, tabela);
  } catch { /* não quebra o combate se a alma falhar */ }

  return {
    tipo:                "ataque",
    acertou,
    critico,
    falha_critica:       falhaCritica,
    dado_bruto:          dadoBruto,
    total_acerto:        dadoBruto + modAtaque,
    ca_alvo:             caJogador,
    dano_causado:        dano,
    tipo_dano:           tipoDano,
    habilidade_usada:    habilidadeUsada,
    hp_jogador_restante: hpJogadorRestante,
    jogador_inconsciente: hpJogadorRestante <= 0,
    caiu_inconsciente:   caiuInconsciente,
    teste_morte:         testeMorte,
  };
}

function executarFuga(entidade, player, entidade_ativa_id) {
  const evoData = {
    novo_nome:            `${entidade.nome_unico}, o Marcado`,
    novo_historico:       `Escapou de ${player.nome} após um ataque brutal. Guarda rancor.`,
    nova_personalidade:   `Traumatizado e com ódio crescente por ${player.nome}. Mais cauteloso.`,
    alteracao_hp_maximo:  5,
    alteracao_bonus_ca:   1,
    alteracao_bonus_dano: 1,
  };

  applyNemesisEvolution(entidade_ativa_id, evoData);
  updateActiveEntityHP(entidade_ativa_id, entidade.hp_atual, "fugiu");

  // ---- ALMA: fuga grava medo intenso e memória de trauma ----
  try {
    updateEmotionalState(entidade.id, {
      emocoes: {
        medo:      +4,
        raiva:     +3,
        esperanca: -2,
      },
      humor_geral: "paranóico",
    }, "entidades_vivas");

    addRichMemory(
      entidade.id,
      criarMemoriaRica(
        "trauma",
        `Fugi de ${player.nome}. Cada passo era agonia. Mas eu vou voltar.`,
        7,
        ["jogador"]
      ),
      "entidades_vivas"
    );
  } catch { /* não quebra */ }

  logWorldEvent(
    "fuga",
    `${entidade.nome_unico} fugiu de ${player.nome} e evoluiu pelo Sistema Nemesis.`,
    [entidade_ativa_id]
  );

  return {
    tipo:     "fuga",
    mensagem: `${entidade.nome_unico} recuou às sombras... mas ficou mais forte.`,
    nemesis:  evoData,
  };
}

function executarDialogo(entidade, entidade_ativa_id) {
  updateActiveEntityHP(entidade_ativa_id, entidade.hp_atual, "dialogando");

  // ---- ALMA: abrir diálogo reduz raiva, aumenta levemente esperança ----
  try {
    updateEmotionalState(entidade.id, {
      emocoes: {
        raiva:     -2,
        esperanca: +2,
        medo:      -1,
      },
    }, "entidades_vivas");
  } catch { /* não quebra */ }

  logWorldEvent(
    "dialogo",
    `${entidade.nome_unico} baixou as armas para dialogar.`,
    [entidade_ativa_id]
  );

  return {
    tipo:     "dialogo",
    mensagem: `${entidade.nome_unico} abaixa as armas. "Espere... podemos conversar."`,
  };
}

function executarRendicao(entidade, entidade_ativa_id) {
  updateActiveEntityHP(entidade_ativa_id, entidade.hp_atual, "rendido");

  // ---- ALMA: rendição é medo máximo + esperança de sobreviver ----
  try {
    updateEmotionalState(entidade.id, {
      emocoes: {
        medo:      +5,
        raiva:     -3,
        esperanca: +1,
      },
      humor_geral: "desesperado",
    }, "entidades_vivas");

    addRichMemory(
      entidade.id,
      criarMemoriaRica(
        "humilhacao",
        `Me ajoelhei diante de ${entidade.relacao_com_jogador ?? "o jogador"}. Nunca esquecerei essa humilhação.`,
        6,
        ["jogador"]
      ),
      "entidades_vivas"
    );
  } catch { /* não quebra */ }

  logWorldEvent(
    "rendicao",
    `${entidade.nome_unico} se rendeu.`,
    [entidade_ativa_id]
  );

  return {
    tipo:     "rendicao",
    mensagem: `${entidade.nome_unico} cai de joelhos. "Não me mate! Me poupe!"`,
  };
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

export async function processEntityTurn(entidade_ativa_id, jogador_id) {
  const entidade = getActiveEntity(entidade_ativa_id);
  const player   = getPlayer(jogador_id);

  const statusBloqueantes = ["morto", "fugiu", "rendido", "dialogando", "inconsciente"];
  if (!entidade || statusBloqueantes.includes(entidade.status)) return null;
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);

  // ---- DECISÃO DA IA ----
  let iaDecision   = DECISAO_FALLBACK;
  let usouFallback = false;

  try {
    const messages  = buildPrompt(entidade, player);
    const rawOutput = await callOllama(messages);
    iaDecision      = parseDecisao(rawOutput);
  } catch (err) {
    console.warn(`[EntityTurn] IA falhou para "${entidade.nome_unico}": ${err.message}. Usando fallback.`);
    usouFallback = true;
  }

  // ---- EXECUÇÃO ----
  let dadosMecanicos;
  switch (iaDecision.decisao) {
    case "atacar":  dadosMecanicos = executarAtaque(entidade, player, jogador_id);         break;
    case "fugir":   dadosMecanicos = executarFuga(entidade, player, entidade_ativa_id);    break;
    case "dialogar":dadosMecanicos = executarDialogo(entidade, entidade_ativa_id);         break;
    case "render":  dadosMecanicos = executarRendicao(entidade, entidade_ativa_id);        break;
    default:        dadosMecanicos = executarAtaque(entidade, player, jogador_id);
  }

  return {
    nome:            entidade.nome_unico,
    tipo_entidade:   entidade.tipo_entidade,
    decisao:         iaDecision.decisao,
    pensamento:      iaDecision.pensamento,
    usou_fallback:   usouFallback,
    dados_mecanicos: dadosMecanicos,
  };
}