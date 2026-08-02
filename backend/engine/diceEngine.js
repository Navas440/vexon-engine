// ==========================================
// MOTOR DE DADOS DE VEXON
// ==========================================

// Dados "canônicos" do RPG — usados para validação opcional
const DADOS_CANONICOS = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

// ==========================================
// NÚCLEO: ROLA UM ÚNICO DADO
// ==========================================

/**
 * Rola um único dado com N lados.
 * @param {number} lados - Número de lados (>= 2)
 * @returns {number}
 */
function rolarUm(lados) {
  if (!Number.isInteger(lados) || lados < 2) {
    throw new Error(`Dado inválido: d${lados}. Lados devem ser inteiros >= 2.`);
  }
  return Math.floor(Math.random() * lados) + 1;
}

// ==========================================
// PARSER DE NOTAÇÃO COMPLETA
// ==========================================

/**
 * Faz parse de uma notação completa de dados.
 * Suporta: "2d6", "1d20+5", "3d8-2", "d20", "4d6kh3" (keep highest 3)
 *
 * @param {string} notation
 * @returns {{ quantidade: number, lados: number, bonus: number, keep: {tipo:'kh'|'kl', n:number}|null }}
 */
function parseNotation(notation) {
  const str = String(notation).toLowerCase().trim();

  // Regex: (quantidade?)d(lados)(keep?)(bonus?)
  // Exemplos cobertos: "2d6", "d20", "1d20+5", "3d8-2", "4d6kh3", "d20kl1"
  const match = str.match(/^(\d*)d(\d+)(k[hl]\d+)?([+-]\d+)?$/);

  if (!match) {
    throw new Error(`Notação de dado inválida: "${notation}". Use o formato "XdY", "XdY+Z" ou "XdYkhN".`);
  }

  const quantidade = match[1] === '' ? 1 : parseInt(match[1]);
  const lados      = parseInt(match[2]);
  const bonus      = match[4] ? parseInt(match[4]) : 0;

  let keep = null;
  if (match[3]) {
    const tipo = match[3].startsWith('kh') ? 'kh' : 'kl';
    const n    = parseInt(match[3].slice(2));
    keep = { tipo, n };
  }

  if (quantidade <= 0)   throw new Error(`Quantidade de dados inválida: ${quantidade}.`);
  if (lados < 2)         throw new Error(`Dado inválido: d${lados}. Lados devem ser >= 2.`);
  if (keep && keep.n <= 0) throw new Error(`Keep inválido: deve manter >= 1 dado.`);
  if (keep && keep.n > quantidade) throw new Error(`Keep (${keep.n}) maior que a quantidade de dados (${quantidade}).`);

  return { quantidade, lados, bonus, keep };
}

// ==========================================
// FUNÇÕES PRINCIPAIS EXPORTADAS
// ==========================================

/**
 * Rola dados a partir de uma notação string e retorna o TOTAL.
 * Versão simples para uso interno nas engines.
 *
 * @param {string} notation  Ex: "2d6", "1d20+3", "4d6kh3"
 * @returns {number} total rolado
 */
export function rollDice(notation) {
  return rollDetailed(notation).total;
}

/**
 * Rola dados e retorna resultado detalhado.
 * Ideal para o RPG Master narrar o que aconteceu.
 *
 * @param {string} notation
 * @returns {{
 *   notation: string,
 *   rolagens: number[],
 *   rolagens_descartadas: number[],
 *   bonus: number,
 *   subtotal: number,
 *   total: number
 * }}
 */
export function rollDetailed(notation) {
  const { quantidade, lados, bonus, keep } = parseNotation(notation);

  // Rola todos os dados
  const rolagens = Array.from({ length: quantidade }, () => rolarUm(lados));

  let usadas    = [...rolagens];
  let descartadas = [];

  // Aplica keep highest / keep lowest
  if (keep) {
    const ordenadas = [...rolagens].sort((a, b) => b - a); // maior → menor
    if (keep.tipo === 'kh') {
      usadas      = ordenadas.slice(0, keep.n);
      descartadas = ordenadas.slice(keep.n);
    } else {
      usadas      = ordenadas.slice(-keep.n);
      descartadas = ordenadas.slice(0, quantidade - keep.n);
    }
  }

  const subtotal = usadas.reduce((acc, v) => acc + v, 0);
  const total    = subtotal + bonus;

  return {
    notation,
    rolagens:             rolagens,
    rolagens_usadas:      usadas,
    rolagens_descartadas: descartadas,
    bonus,
    subtotal,
    total,
  };
}

/**
 * Rola um d20 com vantagem (rola 2, usa o maior).
 * @returns {{ resultado: number, rolagens: number[2] }}
 */
export function rollVantagem() {
  const r1 = rolarUm(20);
  const r2 = rolarUm(20);
  return {
    resultado: Math.max(r1, r2),
    rolagens:  [r1, r2],
    tipo:      'vantagem',
  };
}

/**
 * Rola um d20 com desvantagem (rola 2, usa o menor).
 * @returns {{ resultado: number, rolagens: number[2] }}
 */
export function rollDesvantagem() {
  const r1 = rolarUm(20);
  const r2 = rolarUm(20);
  return {
    resultado: Math.min(r1, r2),
    rolagens:  [r1, r2],
    tipo:      'desvantagem',
  };
}

/**
 * Rola um d20 respeitando o modo (normal/vantagem/desvantagem) — mesma
 * lógica de 3 vias que rollD20Test (skillEngine.js) já usava inline,
 * fatorada aqui para reuso em combatEngine.js/entityTurn.js.
 * @param {'normal'|'vantagem'|'desvantagem'} modo
 * @returns {{ resultado: number, rolagens: number[] }}
 */
export function rollD20ComModo(modo = 'normal') {
  if (modo === 'vantagem') {
    const r = rollVantagem();
    return { resultado: r.resultado, rolagens: r.rolagens };
  }
  if (modo === 'desvantagem') {
    const r = rollDesvantagem();
    return { resultado: r.resultado, rolagens: r.rolagens };
  }
  const r = rollDetailed('1d20');
  return { resultado: r.total, rolagens: [r.total] };
}

/**
 * Rola um teste de resistência ou salvaguarda.
 * @param {number} modificador  - Modificador do atributo relevante
 * @param {number} cd           - Classe de dificuldade (CD / DC)
 * @param {'normal'|'vantagem'|'desvantagem'} modo
 * @returns {{ passou: boolean, total: number, rolagem: number, modificador: number, cd: number }}
 */
export function rollSalvaguarda(modificador = 0, cd = 15, modo = 'normal') {
  let rolagem;

  if (modo === 'vantagem')    rolagem = rollVantagem().resultado;
  else if (modo === 'desvantagem') rolagem = rollDesvantagem().resultado;
  else                        rolagem = rolarUm(20);

  const total  = rolagem + modificador;
  const passou = total >= cd;

  return { passou, total, rolagem, modificador, cd, modo };
}

/**
 * Gera os 6 atributos de um personagem usando o método clássico "4d6kh3"
 * (rola 4d6, descarta o menor, soma os 3 maiores) — repetido 6 vezes.
 *
 * @returns {{ atributos: number[], detalhes: object[] }}
 */
export function rollAtributosPersonagem() {
  const detalhes  = Array.from({ length: 6 }, () => rollDetailed('4d6kh3'));
  const atributos = detalhes.map(d => d.total);
  return { atributos, detalhes };
}

/**
 * Rola uma tabela aleatória de N itens e retorna o índice sorteado (1-based).
 * Ex: rollTable(8) → rola 1d8 e retorna o resultado.
 *
 * @param {number} tamanho - Número de entradas na tabela
 * @returns {number} índice de 1 até tamanho
 */
export function rollTable(tamanho) {
  if (!Number.isInteger(tamanho) || tamanho < 1) {
    throw new Error(`Tamanho de tabela inválido: ${tamanho}.`);
  }
  return rolarUm(tamanho);
}

/**
 * Calcula o modificador de atributo padrão D&D 5e.
 * Ex: 10 → 0, 14 → +2, 8 → -1
 *
 * @param {number} valor
 * @returns {number}
 */
export function calculateModifier(valor) {
  return Math.floor((valor - 10) / 2);
}

/**
 * Rola múltiplas notações e retorna a soma total.
 * Útil para "2d6 + 1d4 + 3".
 *
 * @param {...string} notacoes
 * @returns {number}
 */
export function rollMultiple(...notacoes) {
  return notacoes.reduce((acc, n) => {
    // Permite passar números fixos direto ("3", 5, etc.)
    if (!isNaN(Number(n))) return acc + Number(n);
    return acc + rollDice(n);
  }, 0);
}