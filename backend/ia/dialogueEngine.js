import {
  getActiveEntityByName,
  getPlayer,
  addMessageToSession,
  getOrCreateActiveSession,
  logWorldEvent,
  parseJson,
  toJson,
} from "../db/database.js";
import { rollD20Test, DC }                                    from "../engine/skillEngine.js";
import { getEmotionalContext, processDialogueEmotions }       from "./npcsoulEngine.js";
import db                                                     from "../db/database.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const TIMEOUT      = 20000;

// ==========================================
// STATUS E CONSEQUÊNCIAS
// ==========================================

const STATUS_VALIDOS = new Set(["dialogando", "pacifico", "rendido", "hostil", "fugiu"]);

const STATUS_CONSEQUENCIAS = {
  pacifico:   "A entidade baixou as armas permanentemente.",
  rendido:    "A entidade se entregou — pode ser interrogada ou poupada.",
  hostil:     "A entidade voltará a atacar no próximo turno.",
  fugiu:      "A entidade aproveitou o diálogo para escapar.",
  dialogando: null,
};

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
        messages,
        stream:   false,
        options: {
          temperature: 0.8,
          top_p:       0.92,
          num_predict: 400,
          ...opcoes,
        },
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
// MEMÓRIA DE DIÁLOGO (campo `memoria` do banco)
// ==========================================

function getDialogueHistory(entidade) {
  const memoria = parseJson(entidade.memoria, []);
  return memoria.filter(m => m.tipo === "dialogo").slice(-10);
}

function saveDialogueToMemory(entidade, falaJogador, respostaEntidade) {
  const memoria = parseJson(entidade.memoria, []);
  memoria.push({
    tipo:      "dialogo",
    jogador:   falaJogador,
    entidade:  respostaEntidade,
    timestamp: Date.now(),
  });
  db.prepare("UPDATE entidades_vivas SET memoria = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
    .run(toJson(memoria.slice(-20)), entidade.id);
}

// ==========================================
// BUILDER DE PROMPT (com alma integrada)
// ==========================================

function buildEntitySystemPrompt(entidade, player) {
  const personalidade = entidade.nova_personalidade || entidade.personalidade || "Neutro e cauteloso.";
  const hpPercent     = Math.round((entidade.hp_atual / entidade.hp_maximo) * 100);
  const estadoFisico  = hpPercent > 60 ? "saudável"
                      : hpPercent > 25 ? "ferido e sangrando"
                      : "gravemente ferido, à beira da morte";

  const historico    = getDialogueHistory(entidade);
  const memoriaTexto = historico.length > 0
    ? historico.map(h => `Jogador: "${h.jogador}" | Você respondeu: "${h.entidade}"`).join("\n")
    : "Este é o primeiro contato.";

  // Detecta a tabela correta: entidade viva ou NPC do compêndio
  const tabela       = entidade.tipo_entidade ? "entidades_vivas" : "npcs";
  const ctxEmocional = getEmotionalContext(entidade.id, tabela);

  // Bloco de alma — injeta vida interior no prompt se disponível
  const blocoAlma = ctxEmocional?.resumo_prompt
    ? `\nSua vida interior neste momento:\n${ctxEmocional.resumo_prompt}`
    : "";

  // Relação enriquecida pela alma (mais nuançada que o campo cru do banco)
  const descricaoRelacao = ctxEmocional?.descricao_relacao
    ?? entidade.relacao_com_jogador
    ?? "Desconhecido";

  return `Você é ${entidade.nome_unico}, um personagem do RPG sombrio Vexon.
Personalidade: ${personalidade}
Estado físico: ${estadoFisico} (${entidade.hp_atual}/${entidade.hp_maximo} HP)
Relação com ${player?.nome ?? "o jogador"}: ${descricaoRelacao}
Seu objetivo: ${entidade.objetivo ?? "Sobreviver"}
Fação: ${entidade.faccao ?? "Nenhuma"}
Histórico desta conversa:
${memoriaTexto}
${blocoAlma}

Responda SEMPRE com JSON válido. Sem texto antes ou depois.
Formato obrigatório:
{
  "fala": string,
  "pensamento": string,
  "novo_status": "dialogando"|"pacifico"|"rendido"|"hostil"|"fugiu",
  "relacao_atualizada": string,
  "deltas_emocionais": {
    "relacao_jogador": number (-10 a +10),
    "humor_geral": string|null,
    "emocoes": {
      "gratidao"?: number (-5 a +5),
      "medo"?: number (-5 a +5),
      "raiva"?: number (-5 a +5),
      "desconfianca"?: number (-5 a +5),
      "esperanca"?: number (-5 a +5),
      "admiracao"?: number (-5 a +5)
    },
    "intensidade_memoria": number (0-10),
    "tipo_memoria": "interacao"|"gratidao"|"traicao"|"humilhacao"|"cura"|"promessa",
    "descricao_memoria": string
  }
}
relacao_atualizada: como você se sente sobre o jogador em palavras (ex: "desconfiado", "aliado", "com medo").
deltas_emocionais: quanto esta conversa mudou seu estado interno. Use 0 para emoções que não mudaram.`;
}

function buildUserPrompt(falaJogador, resultadoTeste) {
  let contexto = `O jogador disse: "${falaJogador}"`;

  if (resultadoTeste) {
    const qualidade = resultadoTeste.sucesso
      ? resultadoTeste.critico
        ? "com maestria impressionante"
        : `com convincência (rolou ${resultadoTeste.total} vs dificuldade ${resultadoTeste.dc})`
      : resultadoTeste.falha_critica
        ? "de forma completamente desastrosa"
        : `sem convencer (rolou ${resultadoTeste.total} vs dificuldade ${resultadoTeste.dc})`;

    contexto += `\n\nA abordagem foi ${qualidade}. Deixe isso influenciar sua resposta — ${
      resultadoTeste.sucesso
        ? "a fala te afetou mais do que o normal"
        : "a fala soou falsa ou ameaçadora"
    }.`;
  }

  return contexto;
}

// ==========================================
// DETECÇÃO DE INTENÇÃO SOCIAL
// ==========================================

function detectarIntencaoSocial(fala) {
  const texto = fala.toLowerCase();

  if (/ameaç|matar|destruir|acabar com|morra|terror|medo/i.test(texto))
    return { tipo: "intimidacao",  atributo: "carisma",   dc: DC.medio   };
  if (/por favor|implor|piedade|suplico|misericórdia/i.test(texto))
    return { tipo: "suplicar",     atributo: "carisma",   dc: DC.facil   };
  if (/mentira|fingir|enganar|blefar|na verdade|acredite/i.test(texto))
    return { tipo: "engano",       atributo: "carisma",   dc: DC.dificil };
  if (/acordo|proposta|negócio|troca|aliança|juntos/i.test(texto))
    return { tipo: "negociacao",   atributo: "carisma",   dc: DC.medio   };
  if (/verdade|honesto|confio|prometo|juro/i.test(texto))
    return { tipo: "persuasao",    atributo: "carisma",   dc: DC.medio   };
  if (/sabes|sabias|ouvi dizer|informação|segredo/i.test(texto))
    return { tipo: "coleta_info",  atributo: "sabedoria", dc: DC.facil   };

  return { tipo: "neutro", atributo: null, dc: null };
}

function ajustarDC(dc, tipo, entidade) {
  const personalidade = (entidade.nova_personalidade || entidade.personalidade || "").toLowerCase();
  const hpPercent     = (entidade.hp_atual / entidade.hp_maximo) * 100;
  let ajuste          = 0;

  if (hpPercent < 25 && (tipo === "intimidacao" || tipo === "suplicar")) ajuste -= 3;
  if (/covarde|medroso|fraco/.test(personalidade)  && tipo === "intimidacao") ajuste -= 4;
  if (/fanático|leal|honrado/.test(personalidade)  && tipo === "engano")      ajuste += 4;
  if (/arrogante|orgulhoso/.test(personalidade)    && tipo === "persuasao")   ajuste += 3;
  if (/vingativo|ódio/.test(personalidade)         && tipo === "negociacao")  ajuste += 5;

  const relacao = (entidade.relacao_com_jogador || "").toLowerCase();
  if (/aliado|amigo|confia/.test(relacao))    ajuste -= 3;
  if (/inimigo|ódio|desconfia/.test(relacao)) ajuste += 3;

  return Math.max(DC.trivial, dc + ajuste);
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

export async function processDialogue(alvoNome, falaJogador, jogador_id) {
  if (!alvoNome?.trim())    throw new Error("Nenhum alvo de diálogo especificado.");
  if (!falaJogador?.trim()) throw new Error("Fala do jogador está vazia.");

  const entidade = getActiveEntityByName(alvoNome);
  if (!entidade) throw new Error(`Não há ninguém chamado "${alvoNome}" por perto.`);

  if (["morto", "fugiu"].includes(entidade.status)) {
    throw new Error(`${entidade.nome_unico} não pode responder — está ${entidade.status}.`);
  }

  const player = jogador_id ? getPlayer(jogador_id) : null;

  // ---- TESTE SOCIAL ----
  const intencao     = detectarIntencaoSocial(falaJogador);
  let resultadoTeste = null;

  if (intencao.atributo && jogador_id) {
    const dcAjustada           = ajustarDC(intencao.dc, intencao.tipo, entidade);
    resultadoTeste             = rollD20Test(jogador_id, intencao.atributo, dcAjustada);
    resultadoTeste.tipo_social = intencao.tipo;
  }

  // ---- OLLAMA ----
  const systemPrompt = buildEntitySystemPrompt(entidade, player);
  const userPrompt   = buildUserPrompt(falaJogador, resultadoTeste);

  let respostaIA;
  try {
    const raw  = await callOllama([
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ]);
    respostaIA = extrairJson(raw);
  } catch (err) {
    console.warn(`[Dialogue] IA falhou para "${entidade.nome_unico}": ${err.message}`);
    respostaIA = {
      fala:               "...",
      pensamento:         "Algo me distrai por um momento.",
      novo_status:        "dialogando",
      relacao_atualizada: entidade.relacao_com_jogador ?? "Desconhecido",
      deltas_emocionais:  null,
    };
  }

  // ---- VALIDAÇÃO DE STATUS ----
  const novoStatus = STATUS_VALIDOS.has(respostaIA.novo_status)
    ? respostaIA.novo_status
    : "dialogando";

  // ---- ATUALIZA STATUS E RELAÇÃO ----
  const statusMudou  = novoStatus !== entidade.status;
  const relacaoMudou = respostaIA.relacao_atualizada &&
                       respostaIA.relacao_atualizada !== entidade.relacao_com_jogador;

  if (statusMudou || relacaoMudou) {
    db.prepare(`
      UPDATE entidades_vivas
      SET status = ?, relacao_com_jogador = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      novoStatus,
      respostaIA.relacao_atualizada ?? entidade.relacao_com_jogador,
      entidade.id
    );
  }

  // ---- PROCESSA ALMA EMOCIONAL ----
  // Persiste deltas, cria memória rica e verifica gatilhos de evolução
  let evolucaoAlma = null;
  if (jogador_id && respostaIA.deltas_emocionais) {
    try {
      const tabela = entidade.tipo_entidade ? "entidades_vivas" : "npcs";
      evolucaoAlma = processDialogueEmotions(
        entidade.id,
        respostaIA,
        falaJogador,
        tabela
      );

      if (evolucaoAlma?.gatilhos_disparados?.length > 0) {
        for (const g of evolucaoAlma.gatilhos_disparados) {
          logWorldEvent(
            "evolucao_npc",
            `${entidade.nome_unico} transformou-se: "${g.condicao}" atingida durante diálogo.`,
            [entidade.id, jogador_id]
          );
        }
      }
    } catch (err) {
      console.warn(`[Dialogue] Atualização de alma falhou: ${err.message}`);
    }
  }

  // ---- MEMÓRIA DE DIÁLOGO ----
  saveDialogueToMemory(entidade, falaJogador, respostaIA.fala);

  // ---- HISTÓRICO DA SESSÃO ----
  if (jogador_id) {
    const sessao = getOrCreateActiveSession(jogador_id);
    addMessageToSession(sessao.id, "user",      `[Diálogo com ${entidade.nome_unico}]: "${falaJogador}"`);
    addMessageToSession(sessao.id, "assistant", `${entidade.nome_unico}: "${respostaIA.fala}"`);
  }

  // ---- LOG DE EVENTO ----
  if (statusMudou && novoStatus !== "dialogando") {
    logWorldEvent(
      "dialogo",
      `${entidade.nome_unico} ficou ${novoStatus} após conversa com ${player?.nome ?? "o jogador"}.`,
      [entidade.id, ...(jogador_id ? [jogador_id] : [])]
    );
  }

  // ---- RETORNO ----
  return {
    entidade:           entidade.nome_unico,
    fala:               respostaIA.fala,
    pensamento:         respostaIA.pensamento,
    novo_status:        novoStatus,
    status_anterior:    entidade.status,
    status_mudou:       statusMudou,
    relacao_atualizada: respostaIA.relacao_atualizada ?? entidade.relacao_com_jogador,
    consequencia:       STATUS_CONSEQUENCIAS[novoStatus] ?? null,
    teste_social: resultadoTeste ? {
      tipo:    resultadoTeste.tipo_social,
      sucesso: resultadoTeste.sucesso,
      total:   resultadoTeste.total,
      dc:      resultadoTeste.dc,
      margem:  resultadoTeste.margem,
    } : null,
    alma: evolucaoAlma ? {
      gatilhos_disparados: evolucaoAlma.gatilhos_disparados?.length ?? 0,
      humor_resultante:    evolucaoAlma.estado_atualizado?.humor_geral ?? null,
    } : null,
  };
}

// ==========================================
// DIÁLOGO EM GRUPO
// ==========================================

export async function processGroupDialogue(alvosNomes, falaJogador, jogador_id) {
  const resultados = await Promise.allSettled(
    alvosNomes.map(nome => processDialogue(nome, falaJogador, jogador_id))
  );

  return resultados.map((r, i) => ({
    alvo:      alvosNomes[i],
    sucesso:   r.status === "fulfilled",
    resultado: r.status === "fulfilled" ? r.value : { erro: r.reason?.message },
  }));
}