#!/usr/bin/env python3
"""Los iconos de las aplicaciones, todos del mismo dibujo.

Es el mismo reloj para las cinco; lo único que cambia es el color de fondo y
la insignia de abajo a la derecha. Las dos del puesto de control de acceso
salen de los iconos ya aprobados de conductores (azul) y de gestión (morado):
se les tapa la insignia con una barrera sobre una chapa del mismo color. Se hacen aquí y se guardan en el
repositorio para que el móvil y el navegador instalen exactamente el mismo
fichero: cuando cada uno se dibujaba por su lado nunca acababan de cuadrar.

    python3 scripts/iconos.py            # las que faltan
    python3 scripts/iconos.py --todas    # rehace también las que ya están
"""
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELOJ = os.path.join(RAIZ, 'gestion', 'icons', 'reloj.png')
EMOJIS = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'
# Noto Color Emoji solo trae un tamaño de mapa de bits: hay que pedir ese y
# luego reescalar. Con cualquier otro, Pillow no la carga.
TALLA_EMOJI = 109

# fondo, color de la insignia, emoji, y dónde va cada tamaño
APPS = {
    'trabajador':  dict(bg=(21, 101, 192),  chapa=(255, 255, 255), emoji='\U0001F4AA',
                        destino='icons',         nombre='icon'),
    'gestion':     dict(bg=(108, 52, 131),  chapa=(255, 255, 255), emoji='✏️',
                        destino='gestion/icons', nombre='icon'),
    'desarrollador': dict(bg=(44, 62, 80),  chapa=(232, 89, 12),   emoji='⚙️',
                        destino='gestion/icons', nombre='icon-dev'),
    'control':     dict(bg=(21, 101, 192),  chapa=(21, 101, 192),  insignia='barrera',
                        base='icons/icon',         destino='control/icons', nombre='icon'),
    'gcontrol':    dict(bg=(108, 52, 131),  chapa=(108, 52, 131),  insignia='barrera',
                        base='gestion/icons/icon', destino='control/icons', nombre='icon-gc'),
}


def dibujar(cfg, lado, con_fondo=True):
    """El icono a un tamaño. Sin fondo es el de la capa de delante, el que
    Android recorta con la forma que tenga cada lanzador."""
    if con_fondo:
        im = Image.new('RGBA', (lado, lado), cfg['bg'] + (255,))
    else:
        im = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))

    # El reloj, a todo lo ancho. En la capa de delante va más pequeño: el
    # lanzador se come los bordes al recortarla.
    escala = 1.0 if con_fondo else 2 / 3
    lado_reloj = int(lado * escala)
    reloj = Image.open(RELOJ).convert('RGBA').resize((lado_reloj, lado_reloj), Image.LANCZOS)
    hueco = (lado - lado_reloj) // 2
    im.alpha_composite(reloj, (hueco, hueco))

    # La insignia: abajo a la derecha del reloj, no de la imagen
    centro = hueco + lado_reloj * 0.76
    radio = lado_reloj * 0.112
    d = ImageDraw.Draw(im)
    d.ellipse([centro - radio, centro - radio, centro + radio, centro + radio],
              fill=cfg['chapa'] + (255,), outline=(255, 255, 255, 255),
              width=max(1, int(lado_reloj * 0.012)))

    # El emoji dentro, en color
    cara = int(radio * 1.45)
    fuente = ImageFont.truetype(EMOJIS, TALLA_EMOJI)
    sello = Image.new('RGBA', (TALLA_EMOJI * 2, TALLA_EMOJI * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sello).text((TALLA_EMOJI // 2, TALLA_EMOJI // 2), cfg['emoji'],
                               font=fuente, embedded_color=True, anchor='mm')
    caja = sello.getbbox()
    if caja:
        sello = sello.crop(caja)
        ancho = max(1, int(cara * sello.width / max(sello.width, sello.height)))
        alto = max(1, int(cara * sello.height / max(sello.width, sello.height)))
        sello = sello.resize((ancho, alto), Image.LANCZOS)
        im.alpha_composite(sello, (int(centro - ancho / 2), int(centro - alto / 2)))
    return im


def barrera(lado):
    """Una barrera de aparcamiento: el poste a la izquierda y el brazo, a
    franjas rojas y blancas, subiendo hacia la derecha. Se dibuja a cuatro
    veces el tamaño y se reduce, para que los bordes salgan suaves."""
    L = lado * 4
    im = Image.new('RGBA', (L, L), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    oscuro = (40, 40, 48, 255)
    linea = max(2, L // 40)
    # El brazo: un rectángulo girado, hecho a trozos para las franjas
    ang = math.radians(-24)
    x0, y0 = L * 0.30, L * 0.50          # donde nace, en lo alto del poste
    largo, grueso = L * 0.66, L * 0.13
    ux, uy = math.cos(ang), math.sin(ang)
    nx, ny = -uy, ux
    def trozo(a, b, color):
        pts = [(x0 + ux * a + nx * sg * grueso / 2, y0 + uy * a + ny * sg * grueso / 2)
               for a, sg in ((a, -1), (b, -1), (b, 1), (a, 1))]
        d.polygon(pts, fill=color)
    tramos = 5
    for i in range(tramos):
        trozo(largo * i / tramos, largo * (i + 1) / tramos,
              (220, 38, 38, 255) if i % 2 == 0 else (255, 255, 255, 255))
    borde = [(x0 + ux * a + nx * sg * grueso / 2, y0 + uy * a + ny * sg * grueso / 2)
             for a, sg in ((0, -1), (largo, -1), (largo, 1), (0, 1))]
    d.line(borde + borde[:1], fill=oscuro, width=linea, joint='curve')
    # El poste, por delante del brazo
    px0, px1 = L * 0.20, L * 0.40
    py0, py1 = L * 0.42, L * 0.84
    d.rounded_rectangle([px0, py0, px1, py1], radius=L * 0.03,
                        fill=(236, 238, 241, 255), outline=oscuro, width=linea)
    d.rectangle([px0 + linea, py0 + (py1 - py0) * 0.30, px1 - linea, py0 + (py1 - py0) * 0.42],
                fill=(245, 180, 0, 255))
    d.ellipse([L * 0.26, L * 0.46, L * 0.34, L * 0.54], fill=oscuro)
    return im.resize((lado, lado), Image.LANCZOS)


def con_barrera(cfg, fichero):
    """El icono aprobado de base, con su insignia tapada por la de la
    barrera. Va en el mismo sitio y un poco más grande, para cubrirla entera."""
    im = Image.open(os.path.join(RAIZ, fichero)).convert('RGBA')
    lado = im.width
    centro, radio = lado * 0.762, lado * 0.132
    borde = max(1, int(lado * 0.014))
    d = ImageDraw.Draw(im)
    d.ellipse([centro - radio, centro - radio, centro + radio, centro + radio],
              fill=(255, 255, 255, 255))
    r = radio - borde
    d.ellipse([centro - r, centro - r, centro + r, centro + r], fill=cfg['chapa'] + (255,))
    dibujo = barrera(int(r * 2 * 0.82))
    im.alpha_composite(dibujo, (int(centro - dibujo.width / 2), int(centro - dibujo.height / 2)))
    return im


def main():
    todas = '--todas' in sys.argv
    hechos = 0
    for nombre, cfg in APPS.items():
        carpeta = os.path.join(RAIZ, cfg['destino'])
        os.makedirs(carpeta, exist_ok=True)
        piezas = [(f"{cfg['nombre']}-192.png", 192, True),
                  (f"{cfg['nombre']}-512.png", 512, True),
                  (f"{cfg['nombre']}-fg-512.png", 512, False)]
        for fichero, lado, fondo in piezas:
            ruta = os.path.join(carpeta, fichero)
            if os.path.exists(ruta) and not todas:
                continue
            if cfg.get('base'):
                im = con_barrera(cfg, fichero.replace(cfg['nombre'], cfg['base'], 1))
            else:
                im = dibujar(cfg, lado, fondo)
            im.convert('RGB' if fondo else 'RGBA').save(ruta)
            print('✅', os.path.relpath(ruta, RAIZ))
            hechos += 1
    if not hechos:
        print('Ya estaban todos. Con --todas se rehacen.')


if __name__ == '__main__':
    main()
