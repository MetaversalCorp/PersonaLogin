# PersonaLogin

Minimal but fully functional Persona authentication and session management client for RP1.

## Features

- Real MV library integration
- TypeScript with strict type safety
- Minimal dependencies (esbuild, TypeScript)
- Development server with hot reload
- Bootstrap 5 UI
- Complete transaction logging

## Quick Start

```bash
npm install
npm run dev
```

Then open http://localhost:8080 in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build production bundle |
| `npm run dev` | Start development server with hot reload |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run serve` | Serve the built files |
| `npm run clean` | Remove build artifacts |

## Architecture

```
src/
├── types/          # TypeScript type definitions
│   ├── ConnectionState.ts
│   ├── PersonaInfo.ts
│   └── index.ts
├── utils/          # Utility classes
│   └── FlagQueue.ts
├── base/           # Base classes
│   └── Session.ts
├── client/         # Client session management
│   ├── LoginClient.ts
│   ├── UserSession.ts
│   ├── PersonaSession.ts
│   └── InWorldSession.ts
├── avatar/         # Avatar control
│   ├── Avatar.ts
│   └── PersonaPuppet.ts
├── html/           # Static HTML assets
│   └── index.html
└── index.ts        # Application entry point
```

## MV Library Integration

This project integrates with the following Metaversal Corporation libraries:

- `@metaversalcorp/mvmf` - Core framework
- `@metaversalcorp/mvrp` - RP1 protocol
- `@metaversalcorp/mvrp_fabric` - Fabric layer
- `@metaversalcorp/mvrp_map` - World map integration
- `@metaversalcorp/mvxp` - Experience platform
- `@metaversalcorp/mvio` - I/O utilities
