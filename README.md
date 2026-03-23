# DataAuditor

Compare deux sources de données hétérogènes (CSV, DAT, JSON, JSONL, XLSX) selon des règles de contrôle configurées en YAML. Résultats en temps réel, exports CSV/XLSX/HTML.

## Installation

**Prérequis : Python 3.10+**

```bash
# Linux / macOS
bash install.sh

# Windows
Double cliquer sur le script *install.bat*
```

Génère un script de lancement :
* Linux : `dataAuditor.sh`
* Windows : `dataAuditorServer.bat`

## Utilisation

Exécuter le script (via terminal, ou en double cliquant sur le script d'exécution)
La page web de l'outil devrait s'ouvrir. 
Elle sera accessible localement à l'adresse : **http://localhost:5000**.

L'interface guide en 7 étapes : chargement des sources, configuration de la jointure, définition des règles, lancement de l'audit, consultation et export des résultats.

## Mode d'emploi

Un [manuel utilisateur](https://github.com/nikomiko/data-auditor/blob/main/docs/usermanual.md) complet est accessible dans l'application via le bouton **?** en haut à droite.

## Ecrans 

### Résultats
<img width="1868" height="688" alt="image" src="https://github.com/user-attachments/assets/ca67fabb-0ab4-4604-907b-40fad811ea77" />

### Détails 
<img width="1858" height="604" alt="image" src="https://github.com/user-attachments/assets/38db68ef-1fc2-4fdb-84cc-e96cf4dcada1" />

### Configuration des règles de contrôle
<img width="1427" height="647" alt="image" src="https://github.com/user-attachments/assets/77a40cd1-d08f-49d0-9e57-b0298e35096a" />

### Configuration des formats de fichiers par UI
<img width="1849" height="452" alt="image" src="https://github.com/user-attachments/assets/17a39030-769b-49f8-ae05-aae392e5921b" />

