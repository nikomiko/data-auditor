# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec — DataAuditor
# Mode   : onedir  (faster startup, required for pandas/numpy)
# Target : Windows x64
# Usage  : pyinstaller build.spec
#

import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(SPEC))  # directory containing this spec


def src(rel):
    """Absolute path relative to the project root."""
    return os.path.join(HERE, rel)


# ---------------------------------------------------------------------------
# Data files  (source_path, dest_folder_inside_bundle)
# ---------------------------------------------------------------------------
datas = [
    # Main HTML entry point
    (src('index.html'), '.'),

    # Static assets (JS, CSS, SVG)
    (src('static'), 'static'),

    # Documentation
    (src('docs'), 'docs'),

    # Sample / demo data
    (src('sample'), 'sample'),
]

# Optional: Jinja2 templates bundled with the package
datas += collect_data_files('jinja2')

# ---------------------------------------------------------------------------
# Hidden imports
# ---------------------------------------------------------------------------
hiddenimports = [
    # Flask ecosystem
    'flask',
    'flask.templating',
    'jinja2',
    'jinja2.ext',
    'werkzeug',
    'werkzeug.serving',
    'werkzeug.routing',
    'werkzeug.middleware.proxy_fix',
    'click',
    'itsdangerous',

    # openpyxl (XLSX support)
    'openpyxl',
    'openpyxl.cell',
    'openpyxl.chart',
    'openpyxl.chart.bar_chart',
    'openpyxl.chart.line_chart',
    'openpyxl.chart.pie_chart',
    'openpyxl.chart.series',
    'openpyxl.chart.series_factory',
    'openpyxl.chart.reference',
    'openpyxl.drawing',
    'openpyxl.drawing.image',
    'openpyxl.drawing.spreadsheet_drawing',
    'openpyxl.formatting',
    'openpyxl.formatting.rule',
    'openpyxl.reader.excel',
    'openpyxl.reader.strings',
    'openpyxl.reader.workbook',
    'openpyxl.styles',
    'openpyxl.styles.borders',
    'openpyxl.styles.colors',
    'openpyxl.styles.fills',
    'openpyxl.styles.fonts',
    'openpyxl.styles.named_styles',
    'openpyxl.utils',
    'openpyxl.utils.dataframe',
    'openpyxl.workbook',
    'openpyxl.worksheet',
    'openpyxl.worksheet.table',
    'openpyxl.worksheet.worksheet',

    # pandas hidden modules
    'pandas',
    'pandas._libs.tslibs.timedeltas',
    'pandas._libs.tslibs.np_datetime',
    'pandas._libs.tslibs.nattype',
    'pandas._libs.tslibs.timestamps',
    'pandas._libs.tslibs.offsets',
    'pandas._libs.tslibs.parsing',
    'pandas._libs.tslibs.period',
    'pandas._libs.tslibs.tzconversion',
    'pandas._libs.skiplist',
    'pandas._libs.hashtable',
    'pandas._libs.index',
    'pandas._libs.internals',
    'pandas._libs.join',
    'pandas._libs.lib',
    'pandas._libs.missing',
    'pandas._libs.ops',
    'pandas._libs.parsers',
    'pandas._libs.reduction',
    'pandas._libs.reshape',
    'pandas._libs.sparse',
    'pandas._libs.writers',
    'pandas.io.formats.style',
    'pandas.plotting',

    # PyYAML
    'yaml',
    '_yaml',

    # Standard library extras sometimes missed
    'email.mime.text',
    'email.mime.multipart',
    'email.mime.base',
    'email.mime.message',
    'logging.handlers',
    'queue',
    'threading',
    'uuid',
    'csv',
    'json',
    'decimal',
    'datetime',
    'pathlib',
    'io',
    'copy',
    're',
    'collections',
    'collections.abc',
    'functools',
    'itertools',
    'operator',
    'traceback',
    'struct',
]

# Collect all openpyxl submodules dynamically (covers future sub-packages)
hiddenimports += collect_submodules('openpyxl')

# ---------------------------------------------------------------------------
# Exclusions  (shrinks the bundle significantly)
# ---------------------------------------------------------------------------
excludes = [
    # GUI toolkits
    'tkinter',
    '_tkinter',
    'tkinter.ttk',
    'tkinter.messagebox',
    'PyQt5',
    'PyQt6',
    'PySide2',
    'PySide6',
    'wx',
    'gi',
    'gtk',

    # Heavy scientific stack (not used)
    'matplotlib',
    'matplotlib.backends',
    'scipy',
    'sklearn',
    'sklearn.utils',
    'PIL',
    'Pillow',
    'cv2',

    # Jupyter / IPython
    'notebook',
    'IPython',
    'ipykernel',
    'ipywidgets',
    'nbformat',
    'nbconvert',

    # Testing
    'pytest',
    'pytest_cov',
    'unittest',
    '_pytest',

    # Build / packaging tools
    'setuptools',
    'pkg_resources',
    'distutils',
    'pip',

    # Misc unused
    'pydoc',
    'doctest',
    'xmlrpc',
    'ftplib',
    'telnetlib',
    'poplib',
    'imaplib',
    'smtplib',
    'multiprocessing',
    'concurrent.futures',
    'asyncio',
    'tornado',
    'twisted',
    'celery',
    'sqlalchemy',
    'django',
    'fastapi',
    'aiohttp',
]

# ---------------------------------------------------------------------------
# Optional icon
# ---------------------------------------------------------------------------
icon_path = src(os.path.join('tools', 'DataAuditor.ico'))
icon = icon_path if os.path.exists(icon_path) else None

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(
    [src(os.path.join('src', 'server.py'))],
    pathex=[HERE, src('src')],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

# ---------------------------------------------------------------------------
# PYZ archive
# ---------------------------------------------------------------------------
pyz = PYZ(a.pure)

# ---------------------------------------------------------------------------
# EXE
# ---------------------------------------------------------------------------
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,      # onedir: binaries go to COLLECT
    name='DataAuditor',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[
        # DLLs that break when UPX-compressed
        'vcruntime140.dll',
        'python3*.dll',
        'api-ms-win-*.dll',
    ],
    console=True,               # Show server terminal window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon,
)

# ---------------------------------------------------------------------------
# COLLECT — assembles the onedir bundle
# ---------------------------------------------------------------------------
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[
        'vcruntime140.dll',
        'python3*.dll',
        'api-ms-win-*.dll',
    ],
    name='DataAuditor',         # dist/DataAuditor/
)
