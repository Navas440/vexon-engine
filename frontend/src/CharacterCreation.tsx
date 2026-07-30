import { useState, useEffect } from 'react';

type Atributos = {
  forca: number;
  destreza: number;
  resistencia: number;
  inteligencia: number;
  sabedoria: number;
  carisma: number;
};

type Habilidade = { nome: string; descricao: string };

type ClasseInfo = {
  id: string;
  nome: string;
  dado_vida: number;
  atributos_principais: string[];
  descricao: string;
  habilidades_nivel1: Habilidade[];
};

type ItemInicial = {
  chave: string;
  nome: string;
  tipo: string;
  raridade: string;
  dano_ou_efeito: string | null;
  propriedades: string;
  peso: string;
  valor: string;
  descricao: string;
};

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

const ATRIBUTOS_ORDEM: { key: keyof Atributos; label: string }[] = [
  { key: 'forca', label: 'Força' },
  { key: 'destreza', label: 'Destreza' },
  { key: 'resistencia', label: 'Resistência' },
  { key: 'inteligencia', label: 'Inteligência' },
  { key: 'sabedoria', label: 'Sabedoria' },
  { key: 'carisma', label: 'Carisma' },
];

function montarAtribuicaoPadrao(principais: string[]): Atributos {
  const chaves = ATRIBUTOS_ORDEM.map((a) => a.key);
  const ordem = [
    ...principais.filter((p): p is keyof Atributos => (chaves as string[]).includes(p)),
    ...chaves.filter((k) => !principais.includes(k)),
  ];
  const resultado = {} as Atributos;
  ordem.forEach((chave, i) => {
    resultado[chave] = STANDARD_ARRAY[i];
  });
  return resultado;
}

interface CharacterCreationProps {
  onCreated: (jogadorId: number) => void;
}

function CharacterCreation({ onCreated }: CharacterCreationProps) {
  const [classes, setClasses] = useState<ClasseInfo[]>([]);
  const [itensCatalogo, setItensCatalogo] = useState<ItemInicial[]>([]);
  const [limiteItens, setLimiteItens] = useState(3);

  const [nome, setNome] = useState('');
  const [classeSelecionada, setClasseSelecionada] = useState<ClasseInfo | null>(null);
  const [atributos, setAtributos] = useState<Atributos | null>(null);

  const [idade, setIdade] = useState('');
  const [genero, setGenero] = useState<'masculino' | 'feminino' | ''>('');
  const [aparenciaFisica, setAparenciaFisica] = useState('');
  const [personalidade, setPersonalidade] = useState('');
  const [itensSelecionados, setItensSelecionados] = useState<string[]>([]);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/classes')
      .then((r) => r.json())
      .then((data) => setClasses(data.classes ?? []))
      .catch(() => setErro('Falha ao carregar classes do servidor.'));

    fetch('http://localhost:3000/api/starter-items')
      .then((r) => r.json())
      .then((data) => {
        setItensCatalogo(data.itens ?? []);
        if (data.limite) setLimiteItens(data.limite);
      })
      .catch(() => setErro('Falha ao carregar itens iniciais do servidor.'));
  }, []);

  function selecionarClasse(classe: ClasseInfo) {
    setClasseSelecionada(classe);
    setAtributos(montarAtribuicaoPadrao(classe.atributos_principais));
  }

  function trocarAtributo(chave: keyof Atributos, novoValor: number) {
    setAtributos((prev) => {
      if (!prev) return prev;
      const chaveAntiga = (Object.keys(prev) as (keyof Atributos)[]).find((k) => prev[k] === novoValor);
      const atualizado = { ...prev };
      if (chaveAntiga && chaveAntiga !== chave) atualizado[chaveAntiga] = prev[chave];
      atualizado[chave] = novoValor;
      return atualizado;
    });
  }

  function alternarItem(chave: string) {
    setItensSelecionados((prev) => {
      if (prev.includes(chave)) return prev.filter((c) => c !== chave);
      if (prev.length >= limiteItens) return prev;
      return [...prev, chave];
    });
  }

  async function confirmar() {
    if (!podeConfirmar || !classeSelecionada || !atributos) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch('http://localhost:3000/api/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          classe: classeSelecionada.id,
          atributos,
          idade: Number(idade),
          genero,
          aparencia_fisica: aparenciaFisica.trim(),
          personalidade: personalidade.trim(),
          itens: itensSelecionados,
        }),
      });
      const data = await res.json();
      if (!data.sucesso) {
        setErro(data.erro ?? 'Falha ao criar personagem.');
        setEnviando(false);
        return;
      }
      onCreated(data.player.id);
    } catch {
      setErro('Falha na conexão com o servidor.');
      setEnviando(false);
    }
  }

  const idadeNum = Number(idade);
  const podeConfirmar =
    nome.trim().length > 0 &&
    classeSelecionada !== null &&
    Number.isFinite(idadeNum) &&
    idadeNum >= 1 &&
    idadeNum <= 200 &&
    genero !== '' &&
    !enviando;

  return (
    <div className="creation-container">
      <header className="creation-header">
        <h1>VEXON // CRIAÇÃO DE PERSONAGEM</h1>
        <p>Escolha sua classe na barra lateral, dê vida ao seu personagem e entre em Vexon.</p>
      </header>

      <div className="creation-layout">
        <aside className="class-sidebar">
          <h2 className="class-sidebar-titulo">CLASSES</h2>
          <div className="class-sidebar-lista">
            {classes.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`class-sidebar-item ${classeSelecionada?.id === c.id ? 'selecionada' : ''}`}
                onClick={() => selecionarClasse(c)}
              >
                <span className="class-sidebar-nome">{c.nome}</span>
                <span className="class-sidebar-dado">1d{c.dado_vida}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="creation-content">
          <section className="creation-nome">
            <label htmlFor="nome-input">NOME DO PERSONAGEM</label>
            <input
              id="nome-input"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Digite o nome..."
              maxLength={100}
            />
          </section>

          {!classeSelecionada && (
            <div className="creation-placeholder">← Escolha uma classe na barra lateral para continuar.</div>
          )}

          {classeSelecionada && (
            <section className="creation-classe-detalhe">
              <h2>{classeSelecionada.nome}</h2>
              <div className="class-card-dado">Dado de Vida: 1d{classeSelecionada.dado_vida}</div>
              <div className="class-card-atributos">
                Atributos principais: {classeSelecionada.atributos_principais.join(', ')}
              </div>
              <p className="class-card-descricao">{classeSelecionada.descricao}</p>
              <ul className="class-card-habilidades">
                {classeSelecionada.habilidades_nivel1.map((h) => (
                  <li key={h.nome}>
                    <strong>{h.nome}:</strong> {h.descricao}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="creation-persona">
            <h2>IDENTIDADE</h2>
            <div className="persona-grid">
              <div className="persona-field">
                <label htmlFor="idade-input">IDADE</label>
                <input
                  id="idade-input"
                  type="number"
                  min={1}
                  max={200}
                  value={idade}
                  onChange={(e) => setIdade(e.target.value)}
                  placeholder="Ex: 27"
                />
              </div>
              <div className="persona-field">
                <label>GÊNERO</label>
                <div className="genero-opcoes">
                  <button
                    type="button"
                    className={`genero-btn ${genero === 'masculino' ? 'selecionado' : ''}`}
                    onClick={() => setGenero('masculino')}
                  >
                    Masculino
                  </button>
                  <button
                    type="button"
                    className={`genero-btn ${genero === 'feminino' ? 'selecionado' : ''}`}
                    onClick={() => setGenero('feminino')}
                  >
                    Feminino
                  </button>
                </div>
              </div>
            </div>

            <div className="persona-field persona-field-full">
              <label htmlFor="aparencia-input">APARÊNCIA FÍSICA</label>
              <textarea
                id="aparencia-input"
                value={aparenciaFisica}
                onChange={(e) => setAparenciaFisica(e.target.value)}
                placeholder="Como seu personagem é fisicamente: altura, porte, marcas, roupas, cicatrizes..."
                maxLength={1000}
                rows={3}
              />
            </div>

            <div className="persona-field persona-field-full">
              <label htmlFor="personalidade-input">PERSONALIDADE</label>
              <textarea
                id="personalidade-input"
                value={personalidade}
                onChange={(e) => setPersonalidade(e.target.value)}
                placeholder="Como seu personagem se comporta: temperamento, medos, motivações, manias..."
                maxLength={1000}
                rows={3}
              />
            </div>
          </section>

          {classeSelecionada && atributos && (
            <section className="creation-atributos">
              <h2>ATRIBUTOS</h2>
              <p className="creation-atributos-hint">
                Valores disponíveis: {STANDARD_ARRAY.join(', ')} — cada valor é usado uma única vez (escolher um valor já
                usado troca automaticamente com o atributo anterior).
              </p>
              <div className="attr-grid">
                {ATRIBUTOS_ORDEM.map(({ key, label }) => (
                  <div className="attr-row" key={key}>
                    <span className="attr-label">{label}</span>
                    <select value={atributos[key]} onChange={(e) => trocarAtributo(key, Number(e.target.value))}>
                      {STANDARD_ARRAY.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="creation-itens">
            <h2>ITENS INICIAIS</h2>
            <p className="creation-atributos-hint">
              Escolha até {limiteItens} itens para começar sua jornada ({itensSelecionados.length}/{limiteItens}
              selecionados).
            </p>
            <div className="item-grid">
              {itensCatalogo.map((item) => {
                const selecionado = itensSelecionados.includes(item.chave);
                const desabilitado = !selecionado && itensSelecionados.length >= limiteItens;
                return (
                  <button
                    type="button"
                    key={item.chave}
                    className={`item-card ${selecionado ? 'selecionado' : ''} ${desabilitado ? 'desabilitado' : ''}`}
                    onClick={() => alternarItem(item.chave)}
                    disabled={desabilitado}
                  >
                    <div className="item-card-nome">{item.nome}</div>
                    <div className="item-card-tipo">
                      {item.tipo}
                      {item.dano_ou_efeito ? ` · ${item.dano_ou_efeito}` : ''}
                    </div>
                    <div className="item-card-descricao">{item.descricao}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {erro && <div className="creation-erro">{erro}</div>}
        </main>
      </div>

      <footer className="creation-footer">
        <button type="button" className="creation-confirmar" disabled={!podeConfirmar} onClick={confirmar}>
          {enviando ? 'CRIANDO...' : 'FINALIZAR CRIAÇÃO DE PERSONAGEM'}
        </button>
      </footer>
    </div>
  );
}

export default CharacterCreation;
