# Lívia e Henrique · 15.05.27

Site-convite do casamento: convite com envelope personalizado, confirmação de presença por link pessoal, lista de presentes (Pix, cartão, presente físico) e Área dos noivos.

Roda de graça na **Cloudflare Pages** com banco **D1**.

## Estrutura

| Pasta / arquivo | O que é |
|---|---|
| `public/index.html` | o site inteiro (convite, lista, área dos noivos) |
| `functions/api/[[path]].js` | o servidor: confere códigos de convite e a senha, grava e lê do banco |
| `schema.sql` | cria as tabelas do banco (rodar 1 vez) |
| `dados-iniciais.sql` | convites, lista de espera e presentes que já estavam no protótipo (rodar 1 vez) |

## Como colocar no ar (Cloudflare)

### 1. Criar a conta
1. Acesse **dash.cloudflare.com** e crie uma conta grátis (não pede cartão).

### 2. Criar o banco D1
1. No menu da esquerda: **Storage & Databases → D1 SQL Database → Create**.
2. Nome: `casamento` → **Create**.
3. Abra o banco → aba **Console**.
4. Copie todo o conteúdo do arquivo `schema.sql`, cole no console e clique em **Execute**.
5. Faça o mesmo com o conteúdo de `dados-iniciais.sql`.

### 3. Criar o site (Pages) ligado ao GitHub
1. Menu: **Compute (Workers & Pages) → Create → Pages → Connect to Git**.
2. Autorize o GitHub e escolha o repositório **Livia-Henrique**.
3. Em *Build settings*:
   - Framework preset: **None**
   - Build command: *(deixe vazio)*
   - Build output directory: **public**
4. **Save and Deploy**.

### 4. Ligar o banco e a senha
No projeto criado → **Settings**:
1. **Bindings → Add → D1 database**: Variable name **`DB`**, banco **casamento** → Save.
2. **Variables and Secrets → Add**: Type **Secret**, nome **`SENHA`**, valor = a senha da Área dos noivos → Save.
3. Vá em **Deployments** e clique em **Retry deployment** (ou faça um novo deploy) para valer as configurações.

### 5. Testar
- Abra o endereço `https://<nome-do-projeto>.pages.dev`.
- Entre na Área dos noivos (🔒) com a senha.
- Em **Configurações**, confira o **Endereço do site** (pode deixar em branco: o site usa o próprio endereço nos links).

Depois disso, toda atualização enviada a este repositório é publicada sozinha.

## Limites do plano grátis (sobram muito para um casamento)
- 100 mil acessos ao servidor por dia
- Banco D1: 5 GB, 5 milhões de leituras e 100 mil gravações por dia
- Não pausa por falta de uso
