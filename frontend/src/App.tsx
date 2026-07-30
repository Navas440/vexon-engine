import { useState, useEffect } from 'react';
import './App.css';

function App() {
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

  // ==========================================
  // EFEITO DE AUTO-SCAN INICIAL
  // ==========================================
  useEffect(() => {
    const autoScanHUD = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jogador_id: 1, action: "inventario" }) 
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
  }, []); 

  // ==========================================
  // AÇÃO DO JOGADOR
  // ==========================================
  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputStr.trim()) return;

    const textoAcao = inputStr;
    const loadingId = Date.now() + 1;
    
    setLogs((prev) => [...prev, { id: Date.now(), text: `>_ INPUT DETECTADO: "${textoAcao}"`, type: "player" }]);
    setLogs((prev) => [...prev, { id: loadingId, text: "[...PROCESSANDO DADOS VIA GEMINI...]", type: "system" }]);
    setInputStr('');

    try {
      const response = await fetch('http://localhost:3000/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jogador_id: 1, action: textoAcao }) 
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

  return (
    <div className="vexon-container">
      
      {/* SIDEBAR ESQUERDA: STATUS E RADAR */}
      <aside className="sidebar-left">
        <header className="hud-header">
          <div className="profile-info">
            <h2>VEXON // OS</h2>
            <span className="player-name">USUÁRIO: LEONARDO</span>
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