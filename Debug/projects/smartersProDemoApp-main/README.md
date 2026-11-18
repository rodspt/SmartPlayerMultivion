# SmartersProDemoApp — App IPTV para Samsung Smart TV (Tizen)

Aplicativo web para TVs Samsung (Tizen) que consome servidores IPTV no padrão **Xtream Codes** (`player_api.php`), com TV ao vivo, filmes, séries, EPG, favoritos, histórico e controle parental.

Não existe etapa de build de JavaScript: o projeto é HTML/CSS/JS puro. O empacotamento é feito pelas ferramentas Tizen, que geram um `.wgt` assinado.

---

## Sumário

- [Requisitos](#requisitos)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Executar no navegador (desenvolvimento)](#executar-no-navegador-desenvolvimento)
- [Instalar na TV Samsung](#instalar-na-tv-samsung)
- [Configuração](#configuração)
- [Compatibilidade com TVs antigas (importante)](#compatibilidade-com-tvs-antigas-importante)
- [Solução de problemas](#solução-de-problemas)

---

## Requisitos

| Item | Para quê |
|---|---|
| VS Code + extensão **Tizen** (ou Tizen Studio com *TV Extensions*) | Empacotar, assinar e instalar na TV |
| **Certificado Samsung** (author + distributor) | Obrigatório para instalar em TV física |
| TV Samsung com **Developer Mode** ativo, na mesma rede do PC | Destino da instalação |
| Node.js ou Python (opcional) | Servidor local para testar no navegador |

Com a extensão Tizen do VS Code, as ferramentas de linha de comando ficam em:

```
%USERPROFILE%\.tizen-extension-platform\server\sdktools\data\tools\
├── sdb.exe                      # conexão com a TV
└── tizen-core\tz.exe            # build, pack, install, run
```

Os perfis de assinatura ficam em `%USERPROFILE%\.tizen-extension-platform\server\sdktools\sdk-data\profile\profiles.xml`. O perfil usado por este projeto é o **SmartPro**.

---

## Estrutura do projeto

```
index.html                 # Ponto de entrada; carrega todos os CSS/JS e libs via CDN
config.xml                 # Manifesto Tizen (app id, privilégios, ícone)
tizen_web_project.yaml     # Configuração de build da extensão Tizen (lista de arquivos, perfil)
js/main.js                 # Inicialização, registro das teclas do controle remoto
api/apiFunctions.js        # Login e chamadas à API Xtream (filmes, séries, ao vivo, EPG)
config/firebase.js         # Firebase (lista de DNS e analytics)
utils/router.js            # Roteamento entre páginas
utils/constants.js, utils.js, aspectRatioUtils.js
pages/                     # Telas (Login, Home, Movies, Series, Live, Settings...)
pages/settingsPages/       # Formato de stream, formato de hora, controle parental, conta
components/                # Navbar, Toaster, Splash, modais
components/videoPlayers/   # Players de VOD (Video.js) e Flowplayer
css/                       # Um CSS por tela
assets/                    # Imagens e vídeo de splash
Debug/                     # Saída do build (.wgt) — gerada, não editar
```

A rota **Live** (`liveTvPage`) usa `pages/LivePage.js`, e o player ao vivo está em `pages/LiveVideoJsComponent.js` / `components/videoPlayers/FlowPlayer.js`. O arquivo `pages/LiveTVPage.js` é uma versão antiga que não está roteada.

---

## Executar no navegador (desenvolvimento)

Sirva a pasta por HTTP. Não abra o `index.html` com `file://`.

```powershell
npx serve .
# ou
npx http-server . -p 8080
# ou
python -m http.server 8080
```

Abra `http://localhost:8080` e navegue com **setas, Enter e Backspace/Esc**, como no controle remoto.

Limitações no navegador:
- As APIs `tizen`/`webapis` (teclas do controle, sair do app, volume) só existem na TV. No console, o erro de `$WEBAPIS/webapis/webapis.js` é esperado.
- Alguns servidores IPTV bloqueiam requisições do navegador por **CORS**. Nesse caso, teste na TV.

---

## Instalar na TV Samsung

### 1. Preparar a TV (uma vez)

1. Na TV, abra **Apps**, digite `1 2 3 4 5` no controle e ative o **Developer Mode**.
2. Informe o **IP do PC** e reinicie a TV.
3. Anote o IP da TV (Configurações → Geral → Rede → Status da rede).

### Instalação rápida (script)

```powershell
.\tools\install-tv.cmd -Device 192.168.0.194:26101      # ou .\tools\install-tv.ps1
```

O script conecta, faz build, assina, instala e abre o app. A porta padrão é 26101 se for omitida. Opções:
- `-Profile <nome>`: troca o perfil de assinatura.
- `-NoRun`: só instala, sem abrir o app.
- `-ToolsDir <pasta>`: indica outra pasta de ferramentas Tizen.

Os passos manuais estão abaixo.

### 2. Conectar

```powershell
$tools = "$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools"
& "$tools\sdb.exe" connect 192.168.0.194:26101
& "$tools\sdb.exe" devices
```

A saída deve listar a TV como `device`. A porta padrão é **26101**.

### 3. Empacotar, instalar e abrir

```powershell
$tz   = "$env:USERPROFILE\.tizen-extension-platform\server\sdktools\data\tools\tizen-core\tz.exe"
$proj = "<caminho da pasta do projeto>"
$tv   = "192.168.0.194:26101"

& $tz build   -w $proj
& $tz pack    -w $proj                                          # assina com o perfil ativo (SmartPro)
& $tz install -w $proj -p "$proj\Debug\smartersProDemoApp-main.wgt" -e $tv
& $tz run     -w $proj -e $tv
```

- Com **mais de uma TV conectada**, use sempre `-e <ip:porta>` para escolher o destino.
- Pelo VS Code também funciona: *Tizen: Build* → *Tizen: Run on device*.
- Para trocar o perfil de assinatura: `tz security-profiles list` e `tz security-profiles set-active <nome>`.

### Arquivos novos

O `tizen_web_project.yaml` tem uma lista `files:` com o que entra no pacote. **Ao criar um arquivo novo (JS, CSS, imagem), adicione-o a essa lista**, senão ele não vai para a TV. Também é preciso referenciá-lo no `index.html`.

---

## Configuração

### Login / servidor IPTV

Na tela de login, informe **Playlist Name**, **Username**, **Password** e **Server Address** (ex.: `http://servidor:porta`). Sem `http://` ou `https://`, o app tenta os dois.

O app chama `<servidor>/player_api.php?username=...&password=...`. Depois do login, as URLs de vídeo usam o `server_info` devolvido pela API:

```
<protocol>://<url>:<port>/live/<user>/<pass>/<stream_id>.<m3u8|ts>
<protocol>://<url>:<port>/movie/<user>/<pass>/<stream_id>.<ext>
<protocol>://<url>:<port>/series/<user>/<pass>/<episode_id>.<ext>
```

> **Ambiente de testes:** os campos de login estão pré-preenchidos com uma conta de teste (atributos `value="..."` em `pages/LoginPage.js`, inputs da tela de login). **Remova esses valores antes de distribuir o app.**

### Formato de stream (ao vivo)

Em **Settings → Stream Format** escolha `m3u8` (HLS, padrão, usa Video.js) ou `ts` (usa Flowplayer + hls.js).

### Outras configurações

| O quê | Onde |
|---|---|
| ID, nome, ícone e privilégios do app | `config.xml` |
| URL da API de billing/licença | `api/apiFunctions.js` (`apiBaseUrl`) |
| Firebase (DNS e analytics) | `config/firebase.js` |
| Palavras que marcam categorias adultas | `window.adultsCategories` / regex em `pages/LivePage.js` |
| Formato de hora (12h/24h), controle parental | Tela **Settings** do app |

Os dados do usuário (playlists, favoritos, histórico, preferências) ficam no `localStorage` da TV. Reinstalar com o mesmo app id mantém esses dados; desinstalar apaga.

---

## Compatibilidade com TVs antigas (importante)

TVs Samsung até 2019 (Tizen ≤ 5.0) usam motores Chromium antigos (por exemplo, **RU7100 / Tizen 5.0 → Chromium 63**). Um único recurso de sintaxe moderno faz o arquivo inteiro deixar de carregar, e a tela correspondente para de funcionar sem mensagem visível.

**Não use** nos arquivos JS:

| Evite | Use |
|---|---|
| `catch { }` (sem variável) | `catch (e) { }` |
| `a?.b` (optional chaining) | `a && a.b` |
| `a ?? b` | `a !== null && a !== undefined ? a : b` |
| `Array.prototype.flat`, `Object.fromEntries` | loops / `reduce` |

> Histórico: a TV ao vivo não carregava nessas TVs porque `LiveVideoJsComponent.js` e `FlowPlayer.js` usavam `catch {}`. Isso foi corrigido.

Para verificar a sintaxe depois de editar:

```powershell
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\Debug\\' } | ForEach-Object { node --check $_.FullName }
```

E para procurar sintaxe incompatível: `grep -rnE "catch\s*\{|\?\.|\?\?" --include=*.js pages components api utils js`.

---

## Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| Uma seção inteira não carrega na TV, mas funciona no navegador | Sintaxe JS moderna; veja [Compatibilidade](#compatibilidade-com-tvs-antigas-importante) |
| `Invalid Playlist URL (Status: ...)` no login | Servidor, usuário ou senha incorretos, ou servidor fora do ar. Teste `http://servidor/player_api.php?username=X&password=Y` no navegador |
| `Account not activated` | A API retornou `auth != 1` ou `status != "Active"` |
| Canal fica em "Loading channel..." | Teste a URL `/live/...m3u8` no VLC; tente trocar o formato em Settings → Stream Format |
| `sdb devices` não mostra a TV | Developer Mode desativado, IP do PC errado no Developer Mode, ou PC/TV em redes diferentes |
| Erro de assinatura/instalação | Certificado do perfil ativo não autorizado para essa TV (DUID); gere o certificado distributor incluindo a TV |
| Arquivo novo não aparece na TV | Faltou adicioná-lo em `files:` no `tizen_web_project.yaml` |
| Depurar na TV | `tz run -w <proj> -e <ip:porta> -d` abre o Web Inspector |
