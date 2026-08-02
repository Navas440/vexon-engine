# Plano — Pontos de Recurso por Classe

Pesquisa completa de `Readme.txt` para as 9 classes com recurso próprio, modelo de dados genérico proposto, e ordem de implementação recomendada. Este documento é o registro permanente da decisão — a Tier 1 abaixo foi implementada nesta mesma passada; o resto fica para depois.

## As 9 classes

Fato cruzado confirmado no texto de recuperação de Descanso Longo (Readme.txt:1699-1704): **"Todos os pontos de classe (PS, PU, PE, PA, FV) e habilidades especiais são totalmente restaurados"** — 6 dos 9 sistemas (incluindo PR, cuja própria seção de classe já diz "recuperados num Descanso Curto/Longo" separadamente) são estruturalmente idênticos: **pool plano, máximo = nível do personagem, disponível a partir do nível 2 (nível 1 não tem), recupera 100% em Descanso Curto E Longo.**

| Classe | Recurso | Sigla | Nível 1 | Recuperação | Usos principais (nível 2) |
|---|---|---|---|---|---|
| Ilusionista das Sombras | Pontos de Umbros | PU | — (só a partir do nível 2, = nível) | Curto e Longo | Sombra Tangível (clone ilusório); Fumaça e Espelhos (fica Invisível até atacar ou fim do próximo turno) |
| Arconte | Pontos de Essência | PE | — (= nível a partir do 2) | Curto e Longo | Sobrecarga (rerrola dados de dano 1-2); Transmutar (troca tipo de dano do Raio Elemental) |
| Anomalia Bioenergética | Pontos de Sobrecarga | PS | — (= nível a partir do 2) | Curto e Longo | Salto Assistido; Regeneração Celular Emergencial; Foco de Intensidade (rerrola dados de dano 1-2 do Pulso de Quasiluz) |
| Hacker Corporativo | Pontos de Acesso | PA | — (= nível a partir do 2) | Curto e Longo | Hackear Ambiente (portas/câmeras); Sobrecarga de Arma (encravar arma inimiga) |
| Herdeiro de Pedra | Pontos de Ressonância | PR | — (= nível a partir do 2) | Curto e Longo (ver nota) | Escudo Tectônico (Reação, reduz dano); Terremoto Localizado (derruba inimigos) |
| Desperto Vex | Fator Vex | FV | — (= nível a partir do 2) | Curto e Longo | Regeneração Rápida; Impulso Explosivo; Potencializar (+1d6 no próximo Golpe Instintivo) |
| Tecno-Mago | Slots de Magia | — | 2 slots (1º nível) | Só Longo reseta tudo; Curto recupera parcial via Desfragmentar Disco | Tabela multi-nível (1º-5º), 1 slot por magia conjurada |
| Algoz Cibernético | Medidor de Calor | MC (0-10) | 0 (reseta por combate, não por nível) | Não é rest-based — reseta a 0 no início de cada combate; reduz via Ventilação Ativa (-3) | Gera Calor para efeitos extras; tiers 4-7/8-9/10 com efeitos colaterais escalonados |
| Bastião Implacável | Cargas de Sacrifício | CS (máx. 5, fixo em todos os níveis) | 0 | Ganho ao tomar dano (1) ou tomar dano no lugar de aliado (2); dissipa 1 min após combate | +2 dano corpo a corpo por carga ativa (passivo); Descarregar Fúria (converte cargas em 1d8/carga) |

Nota Herdeiro de Pedra: a frase de recuperação em Descanso Longo (linha 1699-1704) lista só "PS, PU, PE, PA, FV", sem mencionar PR — mas a própria seção da classe (linha 1052) diz "recuperados num Descanso Curto/Longo" separadamente. Tratamos como seguindo a mesma regra dos outros 5, mas isso deve ser reconfirmado lendo o texto de novo quando for a vez desta classe, em vez de herdar esta suposição.

`classData.js` não tinha nenhum campo de recurso antes desta tarefa. `handleMagia` (gameEngine.js) é 100% genérico — DC13 fixo, 2d6 de dano, ignora classe por completo. Os ataques de assinatura reais das classes conjuradoras (Pulso de Quasiluz, Raio Sombrio, Sintonização Primordial, Compilador Sintético, Golpe Instintivo) já passam por `calculateAttack`/`executarAtaque` via `ataque_assinatura`, alcançados pelo intent **combate** ("eu ataco"), não pelo intent **magia**.

## Modelo de dados genérico

`classData.js`, campo novo **só nas classes efetivamente implementadas** (metadado sem código funcionando atrás fica pela metade, por isso as outras 6 não ganham o campo nesta passada):

```js
recurso_classe: {
  nome: "Pontos de Essência",
  sigla: "PE",
  recupera_em: ["curto", "longo"],
}
```
Máximo não é armazenado como número fixo — é calculado em runtime (`player.nivel`, a partir do nível 2) por `resourceEngine.js`.

`backend/engine/resourceEngine.js` (novo):
- `gastarRecurso(jogador_id, quantidade=1)` — valida que a classe tem `recurso_classe`, valida saldo (`nivel - recurso_classe_gasto`, zero abaixo do nível 2), incrementa gasto, lança erro claro se insuficiente.
- `recuperarRecurso(jogador_id)` — zera `recurso_classe_gasto`.
- `consultarRecurso(jogador_id)` → `{nome, sigla, atual, maximo}`.

`backend/db/database.js`: `addColumnIfMissing('jogadores', 'recurso_classe_gasto', 'INTEGER DEFAULT 0')`.

`backend/engine/restEngine.js`: `descansoCurto` e `descansoLongo` chamam `recuperarRecurso(jogador_id)` também (as duas recuperam PE/PU/PS/PA/PR/FV por completo, conforme o texto cruzado do livro).

## Ordem de implementação

### Tier 1 — implementado nesta passada (3 classes)

**Arconte (PE)** e **Anomalia Bioenergética (PS)**: ambas já têm `ataque_assinatura` ligado ao caminho real de combate (`calculateAttack`), e suas habilidades de nível 2 têm um efeito quase idêntico — "gastar 1 ponto para rerrolar dados de dano que deram 1 ou 2" (Arconte: "Sobrecarga"; Anomalia: "Foco de Intensidade") — simples e de baixo risco como opção detectada por palavra-chave na ação, mesmo padrão já usado em `handleDescanso` para diferenciar curto/longo.

**Ilusionista das Sombras (PU)**: mesma forma de pool; sua habilidade "Fumaça e Espelhos" (gastar 1 PU → fica Invisível) usa diretamente a infraestrutura de Condições implementada nesta mesma sessão — o encaixe mais natural entre as duas tarefas.

Detecção do gasto: palavra-chave na ação (ex.: "sobrecarga"/"ponto de essência" para Arconte, "foco de intensidade"/"ponto de sobrecarga" para Anomalia, "fumaça e espelhos"/"ponto de umbra" para Ilusionista), verificada dentro de `handleCombate` antes de chamar `calculateAttack`, debitando via `gastarRecurso` e aplicando o efeito (rerrolar dano ou aplicar `invisivel`).

### Tier 2 — próxima etapa (não implementado nesta passada)

- **Hacker Corporativo (PA)**: pool idêntico, mas sem handler genérico existente para ações de hacking (trancar porta, sobrecarregar arma) — precisa de um intent/handler novo do zero, mais escopo que "plugar num handler que já existe".
- **Herdeiro de Pedra (PR)**: pool idêntico, mas o uso principal (Escudo Tectônico) é uma **Reação** disparada por ser atingido — não existe sistema de reação/interrupção no motor (tudo resolve em uma chamada só, sem "pausa para o jogador reagir").
- **Desperto Vex (FV)**: pool idêntico, já tem `ataque_assinatura` — poderia ter entrado no Tier 1, mas ficou de fora para não estourar o "2-3 classes" pedido. Bom candidato para a próxima passada (Potencializar é estruturalmente parecido com Sobrecarga/Foco de Intensidade).

### Tier 3 — formato estruturalmente diferente, replanejar quando chegar a vez

- **Tecno-Mago (Slots de Magia)**: tabela multi-nível por nível de magia, recuperação assimétrica (Curto parcial, Longo total) — precisa de um modelo de dados totalmente diferente do pool plano.
- **Algoz Cibernético (Medidor de Calor)**: gauge por combate (não por descanso), com 3 faixas de efeito colateral escalonado e uma condição de "meltdown" a 10 — mecânica de risco/recompensa, não uma reserva de pontos.
- **Bastião Implacável (Cargas de Sacrifício)**: ganho por tomar dano, não por nível — o gatilho é o oposto de "gastar para agir", precisa de hook no recebimento de dano em vez de no gasto de ação.
