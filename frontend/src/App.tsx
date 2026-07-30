import { useState, useEffect } from 'react';
import './App.css';
import CharacterCreation from './CharacterCreation';

function App() {
  const [view, setView] = useState<'loading' | 'create' | 'hud'>('loading');
  const [jogadorId, setJogadorId] = useState<number | null>(null);

  const [isCritical, setIsCritical] = useState(false);
  const [isFailure, setIsFailure] = useState(false);
  const [inputStr, setInputStr] = useState('');
  const [logs, setLogs] = useState([
    { id: 1, text: "SISTEMA OS: VEXON-ENGINE v1.0 INICIALIZADA. CONEXÃO NEURAL ESTABELECIDA.", type: "system" }
  ]);

  const [hp, setHp] = useState(20);
  const [hpMaximo, setHpMaximo] = useState(20);
  const [nivel, setNivel] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpNecessario, setXpNecessario] = useState(1000);
  const [habilidades, setHabilidades] = useState<string[]>([]); 
  const [dinheiro, setDinheiro] = useState(500);
  const [inventario, setInventario] = useState<any[]>([]);
  const [inimigos, setInimigos] = useState<any[]>([]); 
  const [diceLogs, setDiceLogs] = useState<{ id: number, motivo: string, valor: number }[]>([]); 

  const [isTakingDamage, setIsTakingDamage] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState(0);

  const [playerInfo, setPlayerInfo] = useState<any | null>(null);
  const [classeInfo, setClasseInfo] = useState<any | null>(null);
  const [showFicha, setShowFicha] = useState(false);

  // ==========================================
  // VERIFICA SE JÁ EXISTE UM PERSONAGEM AO ABRIR O APP
  // ==========================================
  useEffect(() => {
    fetch('http://localhost:3000/api/players')
      .then((r) => r.json())
      .then((data) => {
        if (data.players && data.players.length > 0) {
          setJogadorId(data.players[0].id);
          setView('hud');
        } else {
          setView('create');
        }
      })
      .catch(() => setView('create'));
  }, []);

  // ==========================================
  // EFEITO DE AUTO-SCAN INICIAL (só roda quando já há personagem)
  // ==========================================
  useEffect(() => {
    if (view !== 'hud' || jogadorId == null) return;

    const autoScanHUD = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jogador_id: jogadorId, action: "inventario" })
        });

        const data = await response.json();

        if (data.dados_mecanicos) {
          if (data.dados_mecanicos.hp_maximo !== undefined) setHpMaximo(data.dados_mecanicos.hp_maximo);
          if (data.dados_mecanicos.nivel !== undefined) setNivel(data.dados_mecanicos.nivel);
          if (data.dados_mecanicos.xp !== undefined) setXp(data.dados_mecanicos.xp);
          if (data.dados_mecanicos.xp_necessario !== undefined) setXpNecessario(data.dados_mecanicos.xp_necessario);

          if (data.dados_mecanicos.habilidades) {
            try {
              const skills = typeof data.dados_mecanicos.habilidades === 'string'
                ? JSON.parse(data.dados_mecanicos.habilidades)
                : data.dados_mecanicos.habilidades;
              setHabilidades(skills);
            } catch(e) { console.error("Erro lendo habilidades"); }
          }
          if (data.dados_mecanicos.ouro !== undefined) setDinheiro(data.dados_mecanicos.ouro);
          if (data.dados_mecanicos.hp !== undefined) setHp(data.dados_mecanicos.hp);
          if (data.dados_mecanicos.inventario) setInventario(data.dados_mecanicos.inventario);
          if (data.dados_mecanicos.inimigos) setInimigos(data.dados_mecanicos.inimigos);
        }
      } catch (error) {
        console.error("Falha no auto-scan inicial:", error);
      }
    };

    autoScanHUD();
  }, [view, jogadorId]);

  // ==========================================
  // CARREGA FICHA COMPLETA DO PERSONAGEM (nome, classe, atributos, identidade)
  // ==========================================
  useEffect(() => {
    if (view !== 'hud' || jogadorId == null) return;

    fetch(`http://localhost:3000/api/player/${jogadorId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.sucesso && data.player) setPlayerInfo(data.player);
      })
      .catch(() => {});

    fetch('http://localhost:3000/api/classes')
      .then((r) => r.json())
      .then((data) => setClasseInfo(data.classes ?? []))
      .catch(() => {});
  }, [view, jogadorId]);

  const classeAtual = Array.isArray(classeInfo)
    ? classeInfo.find((c: any) => c.id === playerInfo?.classe)
    : null;

  // ==========================================
  // AÇÃO DO JOGADOR
  // ==========================================
  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputStr.trim() || jogadorId == null) return;

    const textoAcao = inputStr;
    const loadingId = Date.now() + 1;
    
    setLogs((prev) => [...prev, { id: Date.now(), text: `>_ INPUT DETECTADO: "${textoAcao}"`, type: "player" }]);
    setLogs((prev) => [...prev, { id: loadingId, text: "[...PROCESSANDO DADOS VIA GEMINI...]", type: "system" }]);
    setInputStr('');

    try {
      const response = await fetch('http://localhost:3000/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jogador_id: jogadorId, action: textoAcao })
      });

      const data = await response.json();

      if (data.dados_mecanicos) {
        // Status e Inventário
        if (data.dados_mecanicos.ouro !== undefined) setDinheiro(data.dados_mecanicos.ouro);
        if (data.dados_mecanicos.hp_maximo !== undefined) setHpMaximo(data.dados_mecanicos.hp_maximo);
        if (data.dados_mecanicos.nivel !== undefined) setNivel(data.dados_mecanicos.nivel);
        if (data.dados_mecanicos.xp !== undefined) setXp(data.dados_mecanicos.xp);
        if (data.dados_mecanicos.xp_necessario !== undefined) setXpNecessario(data.dados_mecanicos.xp_necessario);

        if (data.dados_mecanicos.habilidades) {
          try {
            const skills = typeof data.dados_mecanicos.habilidades === 'string' 
              ? JSON.parse(data.dados_mecanicos.habilidades) 
              : data.dados_mecanicos.habilidades;
            setHabilidades(skills);
          } catch(e) {}
        }

        if (data.dados_mecanicos.hp !== undefined) {
          if (data.dados_mecanicos.hp < hp) {
            setIsTakingDamage(true);
            setTimeout(() => setIsTakingDamage(false), 500);
          }
          setHp(data.dados_mecanicos.hp);
        }

        if (data.dados_mecanicos.inventario) setInventario(data.dados_mecanicos.inventario);
        if (data.dados_mecanicos.inimigos) setInimigos(data.dados_mecanicos.inimigos);
        
        // ==========================================
        // 🎲 LOG DE MÚLTIPLOS DADOS BLINDADO
        // ==========================================
        const novosDados: any[] = [];

        if (data.dados_mecanicos.teste && data.dados_mecanicos.teste.dado_bruto !== undefined) {
          novosDados.push({ 
            id: Date.now() + Math.random(), 
            motivo: "Teste", 
            valor: data.dados_mecanicos.teste.dado_bruto 
          });
        }

        if (data.dados_mecanicos.ataque_jogador && data.dados_mecanicos.ataque_jogador.dado_bruto !== undefined) {
          novosDados.push({ 
            id: Date.now() + Math.random(), 
            motivo: "Ataque", 
            valor: data.dados_mecanicos.ataque_jogador.dado_bruto 
          });
        }

        // ==========================================
        // 👇 NOVO CÓDIGO: INSERE O DANO SÓ SE ACERTOU
        // ==========================================
        if (data.dados_mecanicos.ataque_jogador && data.dados_mecanicos.ataque_jogador.acertou) {
          novosDados.push({
            id: Date.now() + Math.random(),
            motivo: "Dano",
            valor: data.dados_mecanicos.ataque_jogador.dano
          });
        }
        // ==========================================

        
        
        if (novosDados.length > 0) {
          const ultimoDado = novosDados[novosDados.length - 1]; 
          setDiceResult(ultimoDado.valor);

          setDiceLogs((prev) => [
            ...novosDados.reverse(), 
            ...prev
          ].slice(0, 6));

          if (ultimoDado.valor === 20) setIsCritical(true);
          if (ultimoDado.valor === 1) setIsFailure(true);

          setIsRolling(true);

          setTimeout(() => {
            setIsRolling(false);
            setIsCritical(false);
            setIsFailure(false);
          }, 2500);
        }
      }

      setLogs((prev) => {
        const filtered = prev.filter(log => log.id !== loadingId);
        return [...filtered, { id: Date.now() + 2, text: data.narrativa, type: "system" }];
      });

    } catch (error) {
      setLogs((prev) => {
        const filtered = prev.filter(log => log.id !== loadingId);
        return [...filtered, { id: Date.now() + 3, text: "ERRO CRÍTICO: FALHA NA CONEXÃO.", type: "system" }];
      });
    }
  };

  if (view === 'loading') {
    return <div className="vexon-loading">INICIALIZANDO SISTEMA VEXON...</div>;
  }

  if (view === 'create') {
    return (
      <CharacterCreation
        onCreated={(id) => {
          setJogadorId(id);
          setView('hud');
        }}
      />
    );
  }

  return (
    <div className="vexon-container">

      {/* SIDEBAR ESQUERDA: STATUS E RADAR */}
      <aside className="sidebar-left">
        <header className="hud-header">
          <div className="profile-info">
            <h2>VEXON // OS</h2>
            <span className="player-name">
              USUÁRIO: {playerInfo?.nome?.toUpperCase() ?? '...'}
              {classeAtual ? ` — ${classeAtual.nome.toUpperCase()}` : ''}
            </span>
            <button type="button" className="ficha-btn" onClick={() => setShowFicha(true)}>
              📋 FICHA DO PERSONAGEM
            </button>
          </div>
          <div className={`hp-bar ${isTakingDamage ? 'dano-critico' : ''}`}>
            VIT: [ {hp} / {hpMaximo} ]
          </div>
          <div className="money-bar">DINHEIRO: {dinheiro}</div>

          <div className="level-info">NÍVEL: {nivel}</div>
          <div className="xp-container">
            <div className="xp-fill" style={{ width: `${Math.min((xp / xpNecessario) * 100, 100)}%` }}></div>
            <div className="xp-text">{xp} / {xpNecessario} XP</div>
          </div>

          {habilidades && habilidades.length > 0 && (
            <div className="skills-zone">
              <h3>⚡ CIBERNÉTICA & SKILLS</h3>
              <div className="skills-list">
                {habilidades.map((skill, index) => (
                   <span key={index} className="skill-badge">{skill}</span>
                ))}
              </div>
            </div>
          )}
        </header>

        <section className="enemy-zone">
          <h3>▲ RADAR DE AMEAÇAS</h3>
          {Array.isArray(inimigos) && inimigos.filter(i => i && i.nome_unico).length === 0 ? (
            <div className="radar-status">[ RADAR LIMPO ]</div>
          ) : (
            inimigos
              .filter(i => i && i.nome_unico)
              .map((inimigo, index) => (
                <div key={index} className="enemy-card">
                  <div className="enemy-sprite">📡 {inimigo.nome_unico}</div>
                  <div className="enemy-hp">
                    VIT: {inimigo.hp_atual}/{inimigo.hp_maximo}
                  </div>
                </div>
              ))
          )}
        </section>
      </aside>

      {/* ÁREA CENTRAL: NARRATIVA */}
      <main className="game-area">
         <div className="narrative-scroll">
            {logs.map((log) => (
              <div key={log.id} className={`log-entry ${log.type}`}>
                {log.text}
              </div>
            ))}
         </div>
         
         <footer className="action-footer">
          <form onSubmit={handleAction} className="action-form">
            <input 
              type="text" 
              placeholder="INSERIR COMANDO..." 
              value={inputStr}
              onChange={(e) => setInputStr(e.target.value)}
              autoFocus
            />
            <button type="submit">EXECUTAR</button>
          </form>
        </footer>
      </main>

      {/* SIDEBAR DIREITA: INVENTÁRIO E LOG DE DADOS */}
      <aside className="sidebar-right">
        <section>
          <h3>🎒 INVENTÁRIO</h3>
          <div className="inventory-grid">
            {inventario.map((item, index) => (
              <div key={index} className="inventory-item">
                <span className="item-icon">{item.equipado ? '⚔️' : '📦'}</span>
                <span className="item-name">{item.quantidade}x {item.nome}</span>
                
                <div className="tooltip-card">
                  <div className="tooltip-title">{item.nome}</div>
                  {item.tipo && <div className="tooltip-stat">TIPO: <span>{item.tipo.toUpperCase()}</span></div>}
                  
                  {(item.dano_ou_efeito || item.dano || item.efeito) && (
                    <div className="tooltip-stat">EFEITO: <span>{item.dano_ou_efeito || item.dano || item.efeito}</span></div>
                  )}
                  
                  {item.propriedades && <div className="tooltip-stat">MODS: <span>{item.propriedades}</span></div>}
                  {item.habilidade_tematica && <div className="tooltip-stat">LORE: <span>{item.habilidade_tematica}</span></div>}
                  {item.descricao && <div className="tooltip-desc">"{item.descricao}"</div>}
                </div>
              </div>
            ))}
          </div>
        </section>

      <section style={{ marginTop: '20px' }}>
          <h3>🎲 LOG DE DADOS</h3>
          <div className="dice-history">
            {diceLogs.map((log) => (
              <div key={log.id} className={`dice-log-item ${log.motivo === 'Dano' ? 'dano-box' : ''}`}>
                <span className="dice-motive">{log.motivo}:</span>
                <span className={`dice-value ${log.valor === 20 && log.motivo !== 'Dano' ? "crit" : ""} ${log.motivo === 'Dano' ? "dano-val" : ""}`}>
                  [ {log.valor} ]
                </span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      {/* FICHA COMPLETA DO PERSONAGEM */}
      {showFicha && (
        <div className="ficha-overlay" onClick={() => setShowFicha(false)}>
          <div className="ficha-modal" onClick={(e) => e.stopPropagation()}>
            <header className="ficha-header">
              <h2>{playerInfo?.nome ?? '...'}</h2>
              <button type="button" className="ficha-fechar" onClick={() => setShowFicha(false)}>✕</button>
            </header>

            {classeAtual && (
              <div className="ficha-classe-nome">{classeAtual.nome} — Nível {nivel}</div>
            )}

            <section className="ficha-secao">
              <h3>IDENTIDADE</h3>
              <div className="ficha-grid">
                <div><span className="ficha-label">Idade:</span> {playerInfo?.idade ?? '—'}</div>
                <div><span className="ficha-label">Gênero:</span> {playerInfo?.genero ?? '—'}</div>
              </div>
              {playerInfo?.aparencia_fisica && (
                <p className="ficha-texto"><span className="ficha-label">Aparência:</span> {playerInfo.aparencia_fisica}</p>
              )}
              {playerInfo?.personalidade && (
                <p className="ficha-texto"><span className="ficha-label">Personalidade:</span> {playerInfo.personalidade}</p>
              )}
            </section>

            <section className="ficha-secao">
              <h3>STATUS</h3>
              <div className="ficha-grid">
                <div><span className="ficha-label">HP:</span> {hp} / {hpMaximo}</div>
                <div><span className="ficha-label">CA:</span> {playerInfo?.ca ?? '—'}</div>
                <div><span className="ficha-label">Nível:</span> {nivel}</div>
                <div><span className="ficha-label">XP:</span> {xp} / {xpNecessario}</div>
                <div><span className="ficha-label">Ouro:</span> {dinheiro}</div>
              </div>
            </section>

            <section className="ficha-secao">
              <h3>ATRIBUTOS</h3>
              <div className="ficha-grid ficha-atributos">
                <div><span className="ficha-label">Força:</span> {playerInfo?.forca ?? '—'}</div>
                <div><span className="ficha-label">Destreza:</span> {playerInfo?.destreza ?? '—'}</div>
                <div><span className="ficha-label">Resistência:</span> {playerInfo?.resistencia ?? '—'}</div>
                <div><span className="ficha-label">Inteligência:</span> {playerInfo?.inteligencia ?? '—'}</div>
                <div><span className="ficha-label">Sabedoria:</span> {playerInfo?.sabedoria ?? '—'}</div>
                <div><span className="ficha-label">Carisma:</span> {playerInfo?.carisma ?? '—'}</div>
              </div>
            </section>

            {classeAtual && (
              <section className="ficha-secao">
                <h3>CLASSE, HABILIDADES & BUFFS</h3>
                <p className="ficha-texto">{classeAtual.descricao}</p>
                <ul className="ficha-habilidades">
                  {classeAtual.habilidades_nivel1?.map((h: any) => (
                    <li key={h.nome}><strong>{h.nome}:</strong> {h.descricao}</li>
                  ))}
                </ul>
                <div className="ficha-buffs">
                  {classeAtual.ataque_assinatura && (
                    <span className="buff-badge">
                      ⚡ Ataque de assinatura: {classeAtual.ataque_assinatura.nome_habilidade} ({classeAtual.ataque_assinatura.dado_dano} {classeAtual.ataque_assinatura.tipo_dano})
                    </span>
                  )}
                  {classeAtual.bonus_dano_dado && (
                    <span className="buff-badge">
                      🗡️ Bônus de dano fixo: +{classeAtual.bonus_dano_dado} ({classeAtual.bonus_dano_tipo})
                    </span>
                  )}
                  {classeAtual.ca_formula && (
                    <span className="buff-badge">🛡️ CA especial de classe ativa</span>
                  )}
                  {!classeAtual.ataque_assinatura && !classeAtual.bonus_dano_dado && !classeAtual.ca_formula && (
                    <span className="buff-badge buff-neutro">Sem modificadores mecânicos passivos nesta versão — combate padrão com arma equipada.</span>
                  )}
                </div>
              </section>
            )}

            <section className="ficha-secao">
              <h3>INVENTÁRIO</h3>
              {inventario.length === 0 ? (
                <div className="ficha-texto">Nenhum item no inventário.</div>
              ) : (
                <ul className="ficha-inventario-lista">
                  {inventario.map((item, index) => (
                    <li key={index}>
                      {item.equipado ? '⚔️ ' : '📦 '}
                      {item.quantidade}x {item.nome}
                      {item.dano_ou_efeito ? ` — ${item.dano_ou_efeito}` : ''}
                      {item.tipo ? ` (${item.tipo})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {/* OVERLAY DO DADO GIGANTE */}
      {isRolling && (
        <div className={`dice-overlay 
          ${isCritical ? "critical-overlay" : ""} 
          ${isFailure ? "failure-overlay" : ""}`}>

          <div className={`dice-rolling 
            ${isCritical ? "dice-critical" : ""} 
            ${isFailure ? "dice-failure" : ""}`}>
            🎲 {diceResult}
          </div>

          {isCritical && <div className="critical-text">CRITICAL HIT</div>}
          {isFailure && <div className="failure-text">CRITICAL FAILURE</div>}
          {isCritical && <div className="particle-burst"></div>}
          {isFailure && <div className="failure-burst"></div>}

        </div>
      )}

    </div>
  );
}

export default App;