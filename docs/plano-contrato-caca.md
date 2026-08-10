# Plano — O Contrato de Caça (Predador Estelar)

Pesquisa de `Readme.txt:1172-1258` ("O Predador Estelar") para avaliar o gap entre a mecânica do livro e o que está implementado hoje (`classData.js:predador_estelar.bonus_dano_dado: "1d6"`, fixo, aplicado em todo ataque via `combatEngine.js`/`entityTurn.js`). **Decisão já tomada e aplicada nesta sessão**: opção (a) abaixo, pelo motivo explicado na seção 4.

## 1. Tabela real de escala do dado

Coluna "Bônus do Contrato" da tabela de progressão (Readme.txt:1177-1225):

| Nível | Bônus do Contrato |
|---|---|
| 1º-4º | 1d6 |
| 5º-8º | 1d8 |
| 9º-10º | 1d10 |

Confirma exatamente a suposição do pedido original: **1d6 (nível 1-4), 1d8 (nível 5-8), 1d10 (nível 9-10)** — 3 faixas, escalando o **tamanho** do dado (d6→d8→d10). Diferente da escala do Herdeiro Tático (Dano Furtivo, 5 faixas de 2 níveis cada, escalando a **quantidade** de dados 1d6→5d6, implementada em `classData.js:getBonusDanoDado` numa tarefa anterior desta sessão) — funções separadas, mesma tabela genérica não reaproveitável às cegas entre as duas classes.

## 2. Tamanho real da mudança de marcação

Texto exato (Readme.txt:1228-1231, "Nível 1: O Contrato de Caça"):

> "A sua mente foca-se num alvo com precisão letal. Como uma Ação Bónus, você pode marcar um inimigo que consiga ver como a sua 'Presa'.
> • Todo o ataque com arma (corpo-a-corpo ou à distância) que fizer contra a Presa causa 1d6 de dano extra (aumenta para 1d8 no nível 5 e 1d10 no nível 9).
> • Você tem Vantagem em testes de Percepção e Sobrevivência para rastrear a Presa.
> • O Contrato só pode ser mudado se a Presa morrer ou se você usar outra Ação Bónus para o transferir."

Ou seja: **o bônus só vale contra a Presa marcada**, não contra qualquer alvo — diferente da implementação atual, que aplica o bônus em todo ataque sem exigir marcação (a mesma simplificação documentada no comentário de `habilidades_nivel1` do Predador Estelar em `classData.js`: "aplicado em todo ataque nesta versão, sem exigir marcação prévia").

Vantagem em testes de Percepção/Sobrevivência para rastrear a Presa é sobre testes de perícia, não dano — fora do escopo desta mudança de qualquer forma.

**Peças necessárias para implementar a marcação de verdade:**
- Coluna nova: `jogadores.presa_id` (`INTEGER DEFAULT NULL`, referenciando `entidades_vivas.id`), via `addColumnIfMissing` — trivial, mesmo padrão de outras colunas desta sessão.
- Ação/intent nova: algo como `"marcar [nome] como presa"` — precisa de uma palavra-chave nova em `INTENT_KEYWORDS` (`gameEngine.js`) e um handler novo (`handleMarcarPresa`, resolvendo o alvo com o mesmo `getActiveEntityByName` já usado em `handleCombate`) — esforço comparável a uma habilidade Tier 1 de recurso de classe, não trivial mas com precedente conhecido no código.
- `calculateAttack` precisaria comparar `alvo.id === player.presa_id` antes de aplicar o bônus (hoje aplica sempre) — mudança pequena de código, mas com efeito observável real: um Predador Estelar que nunca marca nada perde o bônus que hoje tem sempre.
- Regra de troca ("só muda se a Presa morrer ou via nova Ação Bônus") sairia de graça: "marcar" sempre sobrescreveria `presa_id`, que é exatamente o que a Ação Bônus de transferência já permite no livro — não precisaria de lógica extra de expiração/limpeza quando a Presa morre.
- **Risco de UX não-óbvio**: hoje o bônus funciona sem o jogador precisar saber de nada — é automático e invisível. Com marcação real, o jogador precisa aprender e digitar um verbo novo ("marcar X") antes de cada troca de alvo, ou perde o bônus sem aviso nenhum na interface. É uma mudança de sensação de jogo, não só uma correção de regra.

## 3. Opções de escopo

- **(a) Mínima**: só corrigir a tabela de escala do dado, mantendo a simplificação já documentada e aceita ("aplica em todo ataque, sem marcação"). Mesmo escopo exato da tarefa do Herdeiro Tático (Dano Furtivo) já entregue nesta sessão. Risco mínimo.
- **(b) Marcação real**: escala do dado + coluna `presa_id` + intent/handler `"marcar"` + checagem em `calculateAttack`. Risco médio — mecânica nova, mas toda peça já tem precedente direto no código (coluna simples, handler de intent, resolução de alvo por nome).
- **(c) Completa**: (b) + a regra de troca explícita da Presa. Na prática já vem de graça dentro de (b) (explicado acima) — não é um degrau real de esforço adicional, então (c) não é tratada como uma terceira opção separada, e sim como parte natural de (b).

## 4. Decisão

**Opção (a), pré-aprovada e já implementada nesta sessão.** Motivo: manter a mesma política de simplificação nas duas únicas classes que usam `bonus_dano_dado` (Herdeiro Tático e Predador Estelar) — a tarefa anterior já corrigiu a escala do Herdeiro Tático mantendo "aplica em todo ataque, sem Vantagem/aliado adjacente"; tratar o Predador Estelar de forma diferente (exigindo marcação) criaria uma inconsistência de design entre as duas classes irmãs sem motivo forte.

`backend/classData.js:getBonusDanoDado` ganhou um segundo branch por `classeId`, com a tabela de 3 faixas acima (`1d6`/`1d8`/`1d10`), ao lado do branch já existente do Herdeiro Tático — mesma função central, sem duplicar os 3 call sites (`combatEngine.js:calculateAttack`/`entityAttacksPlayer`, `entityTurn.js:executarAtaque`) que já a chamavam.

(b)/(c) ficam documentadas aqui como trabalho futuro, caso o Contrato de verdade (marcação de Presa) seja desejado depois — não implementadas nesta passada.
