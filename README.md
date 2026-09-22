# PWA-DISCOVER 🌎🌀

**DISCOVER** é uma PWA independente de descoberta visual, criada para reunir imagens, cultura, história, natureza, espaço e experiências panorâmicas 360° em uma interface otimizada para celular.

O projeto está sendo construído primeiro como uma PWA independente. **A integração com o Telegrafo fica para uma etapa posterior**, depois dos testes no celular.

---

## 🚀 Estado atual

A fundação está funcional e testada no celular.

### Biblioteca

- **Ver tudo** — catálogo completo.
- **360°** — somente experiências panorâmicas 360°.
- **Cards normais** — imagens que não são panoramas.
- **Feed** — experiência vertical em tela cheia, estilo feed social.

### Experiências 360°

O visualizador usa **Photo Sphere Viewer 5.15.1**.

Funcionalidades atuais:

- rotação por toque;
- zoom;
- tela cheia;
- giroscópio;
- botão de ativação do Giro;
- fonte original;
- visualizador separado do Feed;
- fallback e tratamento de erro;
- suporte a panoramas equiretangulares reais.

O giroscópio é tratado pelo plugin oficial **@photo-sphere-viewer/gyroscope-plugin**.

### Feed

O Feed possui:

- navegação vertical;
- cards em tela cheia;
- imagens normais;
- experiências 360°;
- Giro;
- modo 360 por toque;
- Compartilhar;
- Curtir com estado local;
- visualizador de mídia;
- botão **Voltar** para retornar ao DISCOVER.

**Importante:** o Feed e o visualizador 360 normal possuem caminhos separados para reduzir o risco de uma alteração em uma área quebrar a outra.

---

## 🎬 Modo Cinema

A arquitetura do catálogo segue o conceito:

```
Fontes / APIs
      ↓
GitHub Actions
      ↓
processamento e seleção
      ↓
catalog/discover.json
      ↓
GitHub Pages
      ↓
PWA DISCOVER
```

A abertura da PWA **não consulta NASA, DPLA, Wikimedia ou outras APIs externas para montar o catálogo**.

O usuário recebe o catálogo já preparado pelo pipeline.

---

## 📚 Catálogo

O catálogo principal fica em:

```
catalog/discover.json
```

Cada item pode conter informações como:

- título;
- descrição;
- tipo;
- imagem/thumbnail;
- panorama 360°, quando aplicável;
- fonte;
- autor;
- licença;
- link original;
- tags;
- metadados da fonte.

### Regra importante para 360°

Uma imagem comum de Marte, Lua, rover ou espaço **não é automaticamente 360°**.

Somente arquivos que realmente atendem aos critérios de panorama equiretangular são classificados como:

```
type: "panorama360"
```

Isso permite que o DISCOVER diferencie corretamente:

- 🪐 imagem normal;
- 🌀 panorama 360°.

---

## 🌐 Fontes do Modo Cinema

### NASA

O projeto utiliza a **NASA Image and Video Library** para imagens.

A implementação foi migrada do antigo endpoint de Mars Rover Photos, que não estava mais disponível para esta arquitetura.

A chave da NASA, quando necessária para uma fonte futura, permanece em **GitHub Actions Secrets** e não é publicada no PWA.

### DPLA

O **Digital Public Library of America (DPLA)** possui um adaptador protegido no pipeline.

A chave é fornecida por:

```
DPLA_API_KEY
```

através dos Secrets do GitHub Actions.

### Wikimedia Commons

O Wikimedia Commons possui um adaptador específico para experiências 360°.

O pipeline procura categorias de panoramas equiretangulares e valida os resultados antes de colocá-los no catálogo.

Atualmente o teste inclui, entre outros:

- natureza;
- patrimônio histórico;
- interiores de catedrais;
- Marte;
- espaço.

Os itens preservam informações de autoria, licença e origem sempre que fornecidas pelos metadados do Commons.

### Europeana / NARA

A arquitetura já reserva espaço para essas fontes, mas elas **não são tratadas como fontes ativas do catálogo sem uma implementação específica e compatível com suas regras de API e armazenamento**.

Não são feitas consultas improvisadas.

---

## 🛡️ Proteção contra excesso de APIs

O pipeline possui proteção interna para evitar consultas excessivas.

Configurações principais:

```
API_RATE_LIMIT_PER_RUN
API_MAX_REQUESTS_PER_DAY
API_MIN_INTERVAL_MS
API_BACKOFF_SECONDS
```

Também existe controle de uso diário em:

```
catalog/.api-usage.json
```

O pipeline:

- limita requisições por execução;
- limita requisições por dia;
- respeita intervalo mínimo entre chamadas;
- aplica backoff quando recebe HTTP 429;
- considera falhas de forma conservadora;
- não entra em loops infinitos;
- registra o uso diário em UTC.

---

## ⚡ Cache

O DISCOVER possui camadas de cache para reduzir consultas e melhorar a experiência no celular.

### Catálogo

O catálogo possui cache local com TTL configurável.

Atualmente:

```
CATALOG_CACHE_TTL_HOURS = 24
```

Quando existe um catálogo válido em cache, ele pode ser mostrado imediatamente.

Se o cache estiver expirado, o aplicativo pode mostrar a versão existente enquanto tenta atualizar.

Se a rede falhar, o último catálogo válido pode continuar sendo utilizado.

### Busca

A busca utiliza somente o catálogo local.

```
SEARCH_CACHE_TTL_HOURS = 6
```

Portanto, digitar:

```
Marte
Museu
Lua
Egito
360
```

não dispara uma consulta à NASA, Wikimedia ou DPLA.

A busca trabalha primeiro sobre o catálogo já disponível na PWA.

---

## 📱 PWA

A aplicação possui:

- Manifest;
- ícones de instalação;
- Service Worker;
- cache do shell;
- layout responsivo;
- interface otimizada para celular;
- suporte a instalação como PWA.

O Service Worker possui versões próprias para garantir que alterações importantes de código sejam atualizadas no navegador.

---

## 🏗️ Estrutura principal

```
PWA-DISCOVER/
│
├── index.html
├── style.css
├── app.js
├── viewer.js
├── manifest.json
├── service-worker.js
│
├── catalog/
│   ├── discover.json
│   ├── config.json
│   └── .api-usage.json
│
├── scripts/
│   └── catalog_pipeline.py
│
├── .github/
│   └── workflows/
│       └── discover-catalog.yml
│
├── icon-192.png
├── icon-512.png
└── README.md
```

---

## 🤖 GitHub Actions

O pipeline é executado manualmente ou por agendamento.

Responsabilidades:

1. carregar a configuração;
2. verificar limites;
3. consultar as fontes habilitadas;
4. selecionar os itens;
5. validar os dados;
6. remover duplicidades quando configurado;
7. preservar itens locais quando necessário;
8. gerar o catálogo;
9. registrar o consumo das APIs;
10. publicar a alteração no repositório.

O frontend continua sendo uma PWA estática.

---

## 🔐 Segurança

As credenciais das APIs não ficam no código público da PWA.

Quando uma fonte exige chave, ela deve ser fornecida pelo GitHub Actions através de **Secrets**.

Exemplos:

```
NASA_API_KEY
DPLA_API_KEY
EUROPEANA_API_KEY
NARA_API_KEY
```

Uma chave não deve ser colocada em:

- `index.html`;
- `app.js`;
- `viewer.js`;
- `catalog/discover.json`;
- código público do GitHub Pages.

---

## 🧭 Roadmap

### Concluído

- [x] Fundação PWA
- [x] Catálogo JSON local
- [x] Busca local
- [x] Cache da busca
- [x] Cache do catálogo
- [x] Service Worker
- [x] Visualizador 360°
- [x] Giroscópio
- [x] GitHub Actions
- [x] Modo Cinema
- [x] NASA Image and Video Library
- [x] DPLA
- [x] Rate limit e proteção de APIs
- [x] Wikimedia Commons 360°
- [x] Feed vertical
- [x] Feed 360°
- [x] Compartilhar
- [x] Curtir local
- [x] Navegação Voltar
- [x] Teste no celular

### Próximas etapas

- [ ] ampliar a curadoria das categorias;
- [ ] melhorar seleção e qualidade dos resultados;
- [ ] ampliar fontes 360°;
- [ ] estudar Europeana de forma específica;
- [ ] estudar NARA respeitando suas regras de API e armazenamento;
- [ ] IndexedDB para histórico e galerias 360°;
- [ ] Feed 360° baseado em experiências persistidas;
- [ ] compartilhamento mais profundo por item;
- [ ] otimizações adicionais para celulares;
- [ ] somente depois dos testes: integração com o Telegrafo.

---

## 🌐 Publicação

Repositório:

https://github.com/detiillimichel-max/PWA-DISCOVER

GitHub Pages:

https://detiillimichel-max.github.io/PWA-DISCOVER/

---

## 🧠 Princípio do projeto

> **DISCOVER não precisa buscar tudo quando o usuário abre.  
> O Cinema prepara. A PWA apresenta.**

A ideia central é separar:

```
COLETA
   ↓
PROCESSAMENTO
   ↓
CATÁLOGO
   ↓
CACHE
   ↓
EXPERIÊNCIA
```

Assim, o aplicativo pode crescer em conteúdo sem transformar cada abertura ou cada busca em uma nova sequência de consultas às APIs externas.

---

## 📌 Nota de estabilidade

A versão atual representa um **checkpoint funcional importante**:

**Biblioteca + Modo Cinema + catálogo + 360° + giroscópio + Feed** estão funcionando como partes independentes.

Alterações futuras devem preservar essa separação e ser feitas de forma incremental, com teste no celular antes da integração com o Telegrafo.
