# Build Windows — DataAuditor

Guide pour produire `DataAuditor_Setup_v3.x.x.exe` distribuable.

---

## Prérequis

| Outil | Version | Lien |
|---|---|---|
| Python | 3.11+ 64 bits | python.org |
| PyInstaller | 6.x | `pip install pyinstaller` |
| Inno Setup | 6.x | jrsoftware.org/isdl.php |
| UPX *(optionnel)* | 4.x | upx.github.io — décompresser dans `PATH` |

```
pip install -r requirements.txt
pip install pyinstaller
```

---

## Workflow complet

### 1. Générer l'icône (une seule fois)

```
python tools/make_icon.py
```

Produit `tools/DataAuditor.ico`. Pour un meilleur résultat, remplacez-le par
une conversion manuelle de `static/favicon.svg` via un outil en ligne
(ex. convertio.co).

### 2. Builder le binaire

```
pyinstaller build.spec
```

Produit `dist/DataAuditor/` — un dossier autonome avec l'exécutable et
toutes ses dépendances.

**Durée typique :** 2–5 min (pandas est gros).

### 3. Tester le binaire

```
dist\DataAuditor\DataAuditor.exe
```

- Une fenêtre console s'ouvre avec les logs du serveur Flask
- Le navigateur s'ouvre automatiquement sur `http://127.0.0.1:5000` (ou le
  premier port libre)
- Les rapports sont sauvegardés dans `dist\DataAuditor\reports\`

### 4. Créer l'installeur Windows

```
ISCC installer.iss
```

Produit `dist\installer\DataAuditor_Setup_v3.6.0.exe`.

---

## Structure du bundle produit

```
dist/DataAuditor/
├── DataAuditor.exe       ← exécutable principal
├── index.html
├── static/               ← JS, CSS, favicon
├── docs/                 ← manuel utilisateur
├── sample/               ← fichiers de démo
├── *.dll / *.pyd         ← dépendances Python
└── reports/              ← créé au premier lancement (rapports générés)
```

---

## Options de lancement

| Option | Description |
|---|---|
| *(aucune)* | Démarre sur le premier port libre, ouvre le navigateur |
| `--port 8080` | Force le port 8080 |
| `--host 0.0.0.0` | Écoute sur toutes les interfaces (réseau local) |
| `--no-browser` | Ne pas ouvrir le navigateur automatiquement |
| `--debug` | Active les logs de debug filtres |

---

## Supprimer la fenêtre console (mode silencieux)

Dans `build.spec`, changer `console=True` → `console=False`.

> **Note :** sans console, les messages d'erreur ne s'affichent nulle part.
> Recommandé uniquement pour les distributions finales bien testées.

---

## Réduire la taille du bundle

La taille typique est ~120–150 Mo (dominée par pandas + numpy).

Actions possibles :
- Installer UPX et s'assurer qu'il est dans le `PATH` (compression ~30 %)
- Utiliser un virtualenv propre dédié au build (évite d'embarquer des
  packages de dev inutiles)
- Exclure des modules supplémentaires dans `build.spec > excludes`

---

## Automatiser avec GitHub Actions

Exemple de workflow `.github/workflows/build-windows.yml` :

```yaml
name: Build Windows

on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt pyinstaller
      - run: python tools/make_icon.py
      - run: pyinstaller build.spec
      - name: Inno Setup
        uses: Minionguyjpro/Inno-Setup-Action@v1.2.2
        with:
          path: installer.iss
      - uses: actions/upload-artifact@v4
        with:
          name: DataAuditor-Setup
          path: dist/installer/*.exe
```
