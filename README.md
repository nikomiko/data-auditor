# DataAuditor

Compare deux sources de données hétérogènes (CSV, DAT, JSON, JSONL, XLSX) selon des règles de contrôle configurées en YAML. Résultats en temps réel, exports CSV/XLSX/HTML.

## Installation

**Prérequis : Python 3.10+**

```bash
# Linux / macOS
bash install.sh

# Windows
install.bat
```

Génère un script de lancement `run.sh` / `dataAuditorServer.bat`.

## Utilisation

```bash
bash run.sh           # Linux / macOS
dataAuditorServer.bat # Windows
```

Ouvrir **http://localhost:5000**.

L'interface guide en 7 étapes : chargement des sources, configuration de la jointure, définition des règles, lancement de l'audit, consultation et export des résultats.

## Mode d'emploi

Un manuel utilisateur complet est accessible dans l'application via le bouton **?** en haut à droite.
