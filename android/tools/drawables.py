# Writes the simple shape/vector drawables. Run once: python android/tools/drawables.py
import os

D = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res", "drawable")
M = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res", "mipmap-anydpi-v26")
os.makedirs(D, exist_ok=True)
os.makedirs(M, exist_ok=True)
A = 'xmlns:android="http://schemas.android.com/apk/res/android"'


def shape(solid, radius, stroke=None):
    s = '<shape %s android:shape="rectangle">\n    <solid android:color="%s" />\n    <corners android:radius="%s" />\n' % (A, solid, radius)
    if stroke:
        s += '    <stroke android:width="@dimen/hairline" android:color="%s" />\n' % stroke
    return s + '</shape>\n'


def ripple(inner):
    return ('<ripple %s android:color="#33FFFFFF">\n    <item>\n%s    </item>\n</ripple>\n'
            % (A, inner.replace(' ' + A, '')))


def vec(w, vb, paths):
    return ('<vector %s android:width="%sdp" android:height="%sdp" android:viewportWidth="%s" android:viewportHeight="%s">\n%s</vector>\n'
            % (A, w, w, vb, vb, paths))


NET = ("M12,12 L12,4 M12,12 L18.9,8 M12,12 L18.9,16 M12,12 L12,20 M12,12 L5.1,16 M12,12 L5.1,8 "
       "M12,4 L18.9,8 L18.9,16 L12,20 L5.1,16 L5.1,8 Z")

files = {
    "bg_card.xml": shape("@color/ink_900", "@dimen/card_radius", "@color/ink_500"),
    "bg_card_confirmed.xml": (
        '<layer-list %s>\n'
        '    <item><shape android:shape="rectangle"><solid android:color="@color/ink_900" /><corners android:radius="@dimen/card_radius" /></shape></item>\n'
        '    <item><shape android:shape="rectangle"><solid android:color="@color/state_confirmed_tint" /><corners android:radius="@dimen/card_radius" />'
        '<stroke android:width="@dimen/hairline" android:color="@color/state_confirmed" /></shape></item>\n'
        '</layer-list>\n' % A),
    "bg_panel.xml": shape("@color/ink_700", "16dp", "@color/ink_500"),
    "bg_field.xml": shape("@color/ink_900", "12dp", "@color/ink_500"),
    "bg_btn_primary.xml": ripple(shape("@color/brand", "12dp")),
    "bg_btn_secondary.xml": ripple(shape("@color/ink_700", "12dp", "@color/ink_500")),
    "bg_chip_reported.xml": shape("@color/transparent", "12dp", "@color/state_caution"),
    "bg_chip_confirmed.xml": shape("@color/state_confirmed", "12dp"),
    "bg_chip_clear.xml": shape("@color/transparent", "12dp", "@color/ink_500"),
    "bg_rule_caution.xml": shape("@color/state_caution", "0dp"),
    # State icons: never colour alone. reported = triangle, confirmed = octagon, clear = circle.
    "ic_state_reported.xml": vec(12, 12, '    <path android:fillColor="@color/state_caution" android:pathData="M6,1 L11.5,11 L0.5,11 Z" />\n'),
    "ic_state_confirmed.xml": vec(12, 12, '    <path android:fillColor="@color/ink_900" android:pathData="M3.5,0.5 L8.5,0.5 L11.5,3.5 L11.5,8.5 L8.5,11.5 L3.5,11.5 L0.5,8.5 L0.5,3.5 Z" />\n'),
    "ic_state_clear.xml": vec(12, 12, '    <path android:strokeColor="@color/text_lo" android:strokeWidth="1.5" android:fillColor="#00000000" android:pathData="M6,1.5 A4.5,4.5 0 1,1 5.99,1.5 Z" />\n'),
    "ic_close.xml": vec(20, 24, '    <path android:strokeColor="@color/text_lo" android:strokeWidth="2" android:strokeLineCap="round" android:pathData="M6,6 L18,18 M18,6 L6,18" />\n'),
    "ic_stat.xml": vec(24, 24,
                       '    <path android:strokeColor="#FFFFFFFF" android:strokeWidth="1.6" android:fillColor="#00000000" android:pathData="%s" />\n'
                       '    <path android:fillColor="#FFFFFFFF" android:pathData="M12,9.5 A2.5,2.5 0 1,1 11.99,9.5 Z" />\n' % NET),
    "ic_tile.xml": vec(24, 24,
                       '    <path android:strokeColor="#FFFFFFFF" android:strokeWidth="1.8" android:fillColor="#00000000" '
                       'android:pathData="M9,4 L7,4 C6.4,4 6,4.4 6,5 L6,21 C6,21.6 6.4,22 7,22 L17,22 C17.6,22 18,21.6 18,21 L18,5 C18,4.4 17.6,4 17,4 L15,4 M9,3 L15,3 L15,6 L9,6 Z" />\n'
                       '    <path android:fillColor="#FFFFFFFF" android:pathData="M12,11 A2,2 0 1,1 11.99,11 Z M9,16 L15,16 L15,17.5 L9,17.5 Z" />\n'),
}

launcher_fg = ('<vector %s android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n'
               '    <group android:translateX="30" android:translateY="30">\n'
               '        <path android:strokeColor="#FF6E5BFF" android:strokeWidth="1.4" android:fillColor="#00000000" android:pathData="%s" />\n'
               '        <path android:fillColor="#FFF4F3F0" android:pathData="M12,9.6 A2.4,2.4 0 1,1 11.99,9.6 Z" />\n'
               '    </group>\n</vector>\n' % (A, NET))
files["ic_launcher_fg.xml"] = launcher_fg

for name, body in files.items():
    with open(os.path.join(D, name), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n' + body)

with open(os.path.join(M, "ic_launcher.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon %s>\n'
            '    <background android:drawable="@color/ink_900" />\n'
            '    <foreground android:drawable="@drawable/ic_launcher_fg" />\n'
            '    <monochrome android:drawable="@drawable/ic_launcher_fg" />\n'
            '</adaptive-icon>\n' % A)
print("wrote", len(files) + 1, "files")
