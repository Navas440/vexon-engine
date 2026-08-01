import dotenv from "dotenv";
dotenv.config();

// ==========================================
// CONFIGURAÇÃO DO OLLAMA (fallback de classificação)
// ==========================================
// Usado por gameEngine.js só quando a classificação local por palavra-chave
// (classificarIntencao) não reconhece a ação e devolve "livre" — cobre casos
// ambíguos tipo "eu tento escalar o muro" que hoje caem direto em narração
// livre sem nenhuma resolução mecânica.

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const TIMEOUT      = 8000; // Classificação precisa ser rápida

// ==========================================
// MAPA DE MANOBRAS → ATRIBUTO + DIFICULDADE
// ==========================================
// Fonte de verdade para os números de um teste de perícia. A IA nunca define
// atributo/CD — só ajuda a reconhecer que a ação é um "teste"; o valor final
// vem sempre desta tabela (ou do fallback genérico em resolverManobra).

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

/**
 * Resolve atributo + dificuldade de um teste a partir do texto da ação.
 * Determinístico — nunca vem da IA. Sem padrão específico, usa o genérico
 * (destreza, CD 12) que já era o default anterior de handleTeste.
 */
export function resolverManobra(texto) {
  for (const manobra of MANOBRAS) {
    if (manobra.padrao.test(texto)) {
      return { atributo: manobra.atributo, dificuldade: manobra.dc };
    }
  }
  return { atributo: "destreza", dificuldade: 12 };
}

// ==========================================
// CLASSIFICADOR VIA OLLAMA (fallback para ações ambíguas)
// ==========================================

/**
 * Usa o Ollama só para decidir a intenção de uma ação que a regex local não
 * reconheceu. Nunca pede número à IA (nem CD, nem dano) — só intent e alvo.
 * Temperatura 0.1 — queremos lógica pura, não criatividade.
 */
export async function classificarComOllama(playerInput) {
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
        options: { temperature: 0.1, num_predict: 60 },
        messages: [
          {
            role: "system",
            content: `Você classifica ações de jogadores de RPG. Responda APENAS com JSON válido, sem texto antes ou depois.
Intents possíveis: "combate", "magia", "dialogo", "inventario", "explorar", "descansar", "teste", "livre"
Use "teste" para qualquer ação física ou mental arriscada que exija um teste de perícia (escalar, arrombar, persuadir, investigar, etc.) e não se encaixe nos outros intents.
Formato obrigatório:
{ "intent": string, "alvo": string|null }`,
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

    const match = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*?\}/);
    if (!match) throw new Error("Sem JSON na resposta do Ollama.");

    const parsed = JSON.parse(match[0]);

    const intentsValidos = new Set(["combate","magia","dialogo","inventario","explorar","descansar","teste","livre"]);
    if (!intentsValidos.has(parsed.intent)) {
      throw new Error(`Intent inválido: "${parsed.intent}"`);
    }

    return {
      intent:    parsed.intent,
      alvo:      parsed.alvo ?? null,
      confianca: "ollama",
    };
  } finally {
    clearTimeout(timer);
  }
}
