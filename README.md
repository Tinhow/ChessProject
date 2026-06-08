# 👑 Chess Online - Multiplayer LAN & Cloud

Um jogo de xadrez multiplayer premium, responsivo e em tempo real, projetado para partidas tanto em rede local (LAN) quanto na nuvem. O projeto possui uma interface moderna baseada em **Glassmorphism**, efeitos sonoros nativos via Web Audio API e suporte completo para espectadores.

🚀 **Jogue agora online:** [https://chessproject-kreo.onrender.com/](https://chessproject-kreo.onrender.com/)

---

## ✨ Funcionalidades Principais

* **Multiplayer em Tempo Real:** Sincronização instantânea de jogadas usando **Socket.io**.
* **Validação de Regras Completa:** Engine de xadrez alimentada pelo **Chess.js** para garantir lances válidos, xeque, xeque-mate, empate (por material insuficiente, afogamento ou repetição) e promoção automática para Dama.
* **Design Premium (Glassmorphism):** Interface sofisticada com tema escuro, brilhos dinâmicos e destaque visual translúcido das casas selecionadas, lances possíveis e última jogada.
* **Notação em Português:** Histórico de jogadas totalmente localizado na notação algébrica em português (ex: **`C`** para Cavalo, **`T`** para Torre, **`D`** para Dama, **`R`** para Rei).
* **Áudio Dinâmico Nativo:** Efeitos sonoros de movimento, captura, xeque e fim de jogo gerados em tempo real pela **Web Audio API** do navegador (sem arquivos pesados de áudio).
* **Modo Espectador:** Opção de entrar nas salas apenas para assistir às partidas em tempo real sem interferir no jogo.
* **Social & Interação:** Chat integrado na barra lateral com envio de mensagens de texto e botões de reação rápida com emojis.
* **Gestão de Partida:** Sistema de proposta de empate, desistência e solicitação de revanche (com inversão automática de cores).

---

## 🛠️ Tecnologias Utilizadas

* **Frontend:** HTML5, CSS3 (Vanilla com variáveis customizadas), JavaScript (Vanilla ES6)
* **Backend:** Node.js, Express
* **Comunicação:** Socket.io
* **Lógica de Xadrez:** Chess.js (via CDN)
* **Design de Peças:** Temas cburnett de alta fidelidade hospedados no CDN do Lichess

---

## 💻 Como Executar Localmente

### Pré-requisitos
Certifique-se de ter o [Node.js](https://nodejs.org/) instalado em sua máquina.

### Passo a Passo

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/Tinhow/ChessProject.git
   cd ChessProject
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Inicie o servidor:**
   ```bash
   node server.js
   ```

4. **Acesse no seu navegador:**
   * **Acesso Local:** [http://localhost:3080](http://localhost:3080)
   * **Acesso na Rede Local (LAN):** Acesse através do IP da máquina host exibido no terminal ao iniciar o servidor (ex: `http://192.168.1.X:3080`), permitindo jogar com outras pessoas conectadas ao mesmo Wi-Fi.

---

## 🔒 Configuração de Firewall (para jogar em Rede Local)
Se outros computadores na mesma rede Wi-Fi não conseguirem se conectar ao seu servidor, o Windows Defender Firewall pode estar bloqueando a porta. Você pode abrir a porta `3080` executando o seguinte comando no PowerShell como **Administrador**:

```powershell
New-NetFirewallRule -DisplayName "Chess LAN Server" -Direction Inbound -LocalPort 3080 -Protocol TCP -Action Allow
```
