import dotenv from "dotenv";
dotenv.config();

// ==========================================
// CONFIGURAÇÃO DO OLLAMA (fallback de IA)
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const TIMEOUT      = 8000; // Classificação precisa ser rápida

// ==========================================
// RESULTADO PADRÃO (fallback de segurança)
// ==========================================

const RESULTADO_FALLBACK = {
  intent:     "livre",
  alvo:       null,
  confianca:  "fallback",
  teste: {
    exige_teste: false,
    atributo:    null,
    dificuldade: 0,
  },
};

// ==========================================
// MAPA DE CLASSIFICAÇÃO LOCAL (sem IA)
// ==========================================
// Ordem importa: regras mais específicas primeiro.

const REGRAS_INTENT = [
  // COMBATE
  {
    intent: "combate",
    padrao: /\b(atac|golpe|matar|mata\b|feri|bater|bato|cortar|corto|disparar|disparo|lanç\w*|chut|soco|espad|flech|tiro|tir[ao]\b|apunhal|decapit|esfaquei|apunhal)\w*/i,
  },
  // MAGIA
  {
    intent: "magia",
    padrao: /\b(lançar|conjur|feitiç|magia|encant|invocar|canal|runa|arcano|ritual|maledição|maldiz)\w*/i,
  },
  // FURTIVIDADE / MANOBRA (antes de explorar para ter prioridade)
  {
    intent: "manobra",
    padrao: /\b(esgueirar|esgueiro|furtiv|esconder|escondo|me escond|flanquear|flanqueio|saltar|salto|pular|pulo|escalar|escalo|acrobacia|rolar|rolo|esquivar|esquivo)\w*/i,
  },
  // DIÁLOGO / SOCIAL
  {
    intent: "dialogo",
    padrao: /\b(fal[ao]\b|dizer|digo\b|conversar|converso|perguntar|pergunto|negociar|negocio|ameaç\w*|intimidar|intimido|persuadir|persuado|suborn\w*|engano|minto|mentir|cumprimentar)\w*/i,
  },
  // INVENTÁRIO
  {
    intent: "inventario",
    padrao: /\b(usar|uso\b|beber|bebi|equipar|equipo|desequipar|inventário|mochila|bolsa|poção|item|consum\w*|pegar|pego|guardar|guardo|dropar|drop)\w*/i,
  },
  // EXPLORAÇÃO / INVESTIGAÇÃO
  {
    intent: "explorar",
    padrao: /\b(examinar|examino|olhar|olho\b|procurar|procuro|investigar|investigo|abrir|abro|entrar|entro|sair|saio|mover|movo|ir para|descer|subir|atravessar|inspecionar|vasculhar)\w*/i,
  },
  // DESCANSO / CURA
  {
    intent: "descansar",
    padrao: /\b(descansar|descanso|dormir|durmo|acampar|acampo|repousar|repouso|curar|curo|bandagem|medicar)\w*/i,
  },
  // TESTE DE PERÍCIA EXPLÍCITO
  {
    intent: "teste",
    padrao: /\b(testar|tento|tentar|rolar|verificar|checar|forçar|arrombar|arrombo|empurrar|empurro|levantar|levanto|quebrar|quebro)\w*/i,
  },
];

// ==========================================
// MAPA DE MANOBRAS → ATRIBUTO + DIFICULDADE
// ==========================================

const MANOBRAS = [
  { padrao: /\b(esgueirar|furtiv|esconder|sombra)\w*/i,       atributo: "destreza",    dc: 13 },
  { padrao: /\b(saltar|pular|acrobacia|rolar|esquivar)\w*/i,  atributo: "destreza",    dc: 12 },
  { padrao: /\b(escalar|trepar|subir em)\w*/i,                atributo: "forca",       dc: 14 },
  { padrao: /\b(empurrar|arrombar|quebrar|forçar)\w*/i,       atributo: "forca",       dc: 15 },
  { padrao: /\b(enganar|blefar|mentir|disfarç)\w*/i,          atributo: "carisma",     dc: 14 },
  { padrao: /\b(persuadir|convencer|negociar)\w*/i,           atributo: "carisma",     dc: 13 },
  { padrao: /\b(intimidar|ameaçar|assustar)\w*/i,             atributo: "carisma",     dc: 12 },
  { padrao: /\b(perceber|notar|detectar|sentir)\w*/i,         atributo: "sabedoria",   dc: 12 },
  { padrao: /\b(investigar|examinar|analisar|decifrar)\w*/i,  atributo: "inteligencia",dc: 13 },
  { padrao: /\b(rastrear|sobreviver|orientar)\w*/i,           atributo: "sabedoria",   dc: 14 },
  { padrao: /\b(concentrar|lembrar|calcular|resolver)\w*/i,   atributo: "inteligencia",dc: 12 },
  { padrao: /\b(resistir|aguentar|suportar|tolerar)\w*/i,     atributo: "resistencia", dc: 13 },
  { padrao: /\b(flanquear|surpreender|emboscar|atacar pelas costas)\w*/i, atributo: "destreza", dc: 14 },
];

// ==========================================
// EXTRATOR DE ALVO
// ==========================================

// Pronomes que indicam "o inimigo atual" — não são alvos específicos
const PRONOMES_GENERICOS = new Set([
  "ele","ela","nele","nela","isso","aquilo","o","a",
  "monstro","inimigo","criatura","ser","entidade","alvo",
]);

/**
 * Tenta extrair o nome do alvo da ação do jogador.
 * Retorna null se não encontrar ou se for um pronome genérico.
 */
function extrairAlvo(texto) {
  // Padrões comuns: "ataco o Goblin", "falo com Ana", "uso poção de cura"
  const padroesAlvo = [
    /(?:atac|golpe|matar|feri|bater|cortar|disparar)\w*\s+(?:o|a|os|as|em|no|na)?\s*([\wÀ-ú\s]{2,30?}?)(?:\s+com|\s+usando|\s+pela|\.|$)/i,
    /(?:fal[ao]|conversar|perguntar|negociar|intimidar)\w*\s+(?:com|ao|à|para)?\s*([\wÀ-ú\s]{2,30?}?)(?:\s+sobre|\s+a|\.|$)/i,
    /(?:usar|beber|equipar|consum)\w*\s+(?:o|a|uma?|um)?\s*([\wÀ-ú\s]{2,25?}?)(?:\s+no|\s+em|\.|$)/i,
    /(?:examinar|abrir|entrar|investigar)\w*\s+(?:o|a|os|as)?\s*([\wÀ-ú\s]{2,25?}?)(?:\.|$)/i,
  ];

  for (const padrao of padroesAlvo) {
    const match = texto.match(padrao);
    if (match) {
      const candidato = match[1].trim().toLowerCase();
      if (candidato && !PRONOMES_GENERICOS.has(candidato) && candidato.length > 1) {
        return candidato;
      }
    }
  }
  return null;
}

// ==========================================
// CLASSIFICADOR LOCAL (FASE 1 — sem IA)
// ==========================================

/**
 * Classifica a intenção usando apenas regex — zero latência, zero custo.
 * Retorna null se não conseguir determinar o intent com confiança.
 */
function classificarLocal(playerInput) {
  const texto = playerInput.toLowerCase().trim();

  for (const regra of REGRAS_INTENT) {
    if (regra.padrao.test(texto)) {
      // Detecta manobra/teste embutido
      let teste = { exige_teste: false, atributo: null, dificuldade: 0 };

      for (const manobra of MANOBRAS) {
        if (manobra.padrao.test(texto)) {
          teste = {
            exige_teste: true,
            atributo:    manobra.atributo,
            dificuldade: manobra.dc,
          };
          break;
        }
      }

      // Manobras e testes explícitos sempre exigem teste
      if (regra.intent === "manobra" || regra.intent === "teste") {
        if (!teste.exige_teste) {
          // Fallback genérico se não achou manobra específica
          teste = { exige_teste: true, atributo: "destreza", dificuldade: 12 };
        }
        // Normaliza "manobra" para "combate" — é um ataque com manobra embutida
        return {
          intent:    regra.intent === "manobra" ? "combate" : "teste",
          alvo:      extrairAlvo(texto),
          confianca: "local",
          teste,
        };
      }

      return {
        intent:    regra.intent,
        alvo:      extrairAlvo(texto),
        confianca: "local",
        teste,
      };
    }
  }

  return null; // Não conseguiu classificar
}

// ==========================================
// CLASSIFICADOR VIA OLLAMA (FASE 2 — fallback)
// ==========================================

/**
 * Usa o Ollama apenas quando a classificação local falha.
 * Temperatura 0.1 — queremos lógica pura, não criatividade.
 */
async function classificarComOllama(playerInput) {
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
        options: { temperature: 0.1, num_predict: 120 },
        messages: [
          {
            role: "system",
            content: `Você classifica ações de jogadores de RPG. Responda APENAS com JSON válido, sem texto antes ou depois.
Intents possíveis: "combate", "magia", "dialogo", "inventario", "explorar", "descansar", "teste", "livre"
Atributos: "forca", "destreza", "resistencia", "inteligencia", "sabedoria", "carisma"
Formato obrigatório:
{ "intent": string, "alvo": string|null, "teste": { "exige_teste": boolean, "atributo": string|null, "dificuldade": number } }`,
          },
          {
            role: "user",
            content: `Ação do jogador: "${playerInput}"\nClassifique:`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const raw  = data.message?.content ?? "";

    // Extrai JSON da resposta
    const match = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*?\}/);
    if (!match) throw new Error("Sem JSON na resposta do Ollama.");

    const parsed = JSON.parse(match[0]);

    // Valida campos obrigatórios
    const intentsValidos = new Set(["combate","magia","dialogo","inventario","explorar","descansar","teste","livre"]);
    if (!intentsValidos.has(parsed.intent)) {
      throw new Error(`Intent inválido: "${parsed.intent}"`);
    }

    return {
      intent:    parsed.intent,
      alvo:      parsed.alvo ?? null,
      confianca: "ollama",
      teste: {
        exige_teste: Boolean(parsed.teste?.exige_teste),
        atributo:    parsed.teste?.atributo ?? null,
        dificuldade: Number(parsed.teste?.dificuldade) || 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

/**
 * Classifica a intenção de uma ação do jogador em duas fases:
 *
 * FASE 1 — Classificação local (regex): zero latência, cobre ~85% dos casos.
 * FASE 2 — Ollama: só ativado para ações ambíguas ou incomuns.
 *
 * @param {string} playerInput - Ação do jogador em texto livre
 * @returns {Promise<{
 *   intent: string,
 *   alvo: string|null,
 *   confianca: 'local'|'ollama'|'fallback',
 *   teste: { exige_teste: boolean, atributo: string|null, dificuldade: number }
 * }>}
 */
export async function classifyIntent(playerInput) {
  if (!playerInput?.trim()) return RESULTADO_FALLBACK;

  const input = playerInput.trim();

  // FASE 1: tenta classificar localmente (sem IA)
  const resultadoLocal = classificarLocal(input);
  if (resultadoLocal) {
    return resultadoLocal;
  }

  // FASE 2: ação ambígua — consulta o Ollama
  try {
    return await classificarComOllama(input);
  } catch (err) {
    // Ação muito curta ou completamente ambígua — trata como ação livre
    if (input.length < 15) {
      return {
        ...RESULTADO_FALLBACK,
        intent:    "livre",
        confianca: "fallback",
      };
    }

    console.warn(`[IntentClassifier] Fallback ativado para: "${input}" — ${err.message}`);
    return RESULTADO_FALLBACK;
  }
}

// ==========================================
// UTILITÁRIOS EXPORTADOS
// ==========================================

/**
 * Versão síncrona para casos onde latência zero é obrigatória.
 * Não consulta o Ollama — retorna fallback se não conseguir classificar.
 */
export function classifyIntentSync(playerInput) {
  if (!playerInput?.trim()) return RESULTADO_FALLBACK;
  return classificarLocal(playerInput.trim()) ?? { ...RESULTADO_FALLBACK, intent: "livre" };
}

/**
 * Retorna todos os intents possíveis e seus padrões (útil para debug e testes).
 */
export function getIntentMap() {
  return REGRAS_INTENT.map(r => ({ intent: r.intent, padrao: r.padrao.toString() }));
}