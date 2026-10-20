"""从母版 logo 生成前端使用的品牌图片（仅依赖 Python 标准库）。

用法：
    python brand/build-branding.py [母版图片路径]

默认读取仓库根目录的「星轨智评logo.png」，生成：
    public/branding/xinggui-logo.png    完整 logo（徽标 + 文字），透明背景，宽 720px
    public/branding/xinggui-symbol.png  方形徽标，透明背景，512x512

登录页 / 注册页使用完整 logo，侧边栏 / 加载页 / 浏览器图标 / 工作台水印使用方形徽标。
"""

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "星轨智评logo.png"
OUT_DIR = ROOT / "public" / "branding"

LOCKUP_WIDTH = 720          # 输出完整 logo 的宽度（登录页约以 240px 展示，3 倍图）
SYMBOL_SIZE = 512           # 输出方形徽标的边长
LOCKUP_PADDING = 0.04       # 完整 logo 四周留白 = 内容最大边 * 该比例
SYMBOL_MARGIN = 0.02        # 徽标裁剪时四周留白
SYMBOL_FILL = 0.88          # 徽标在正方形画布中的占比（其余为透明留白）
ALPHA_THRESHOLD = 8         # 低于该 alpha 视为空白，用于裁剪


def read_png(path):
    """解码 8 位 PNG（支持灰度/RGB/调色板/带 alpha），返回 (w, h, rows)。"""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} 不是 PNG 文件")
    pos, idat, palette, trns = 8, bytearray(), None, None
    width = height = bitdepth = colortype = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bitdepth, colortype, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if interlace != 0:
                raise ValueError("不支持隔行扫描的 PNG")
        elif ctype == b"PLTE":
            palette = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
    if bitdepth != 8:
        raise ValueError("仅支持 8 位 PNG")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    flat = bytearray(stride * height)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src : src + stride])
        src += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise ValueError(f"未知的 PNG 过滤器 {ftype}")
        flat[y * stride : (y + 1) * stride] = line
        prev = line

    rows = []
    for y in range(height):
        row = []
        base = y * stride
        for x in range(width):
            off = base + x * channels
            if colortype == 6:
                row.append(tuple(flat[off : off + 4]))
            elif colortype == 2:
                row.append(tuple(flat[off : off + 3]) + (255,))
            elif colortype == 0:
                g = flat[off]
                row.append((g, g, g, 255))
            elif colortype == 4:
                g, a = flat[off], flat[off + 1]
                row.append((g, g, g, a))
            else:
                idx = flat[off]
                r, g, b = palette[idx * 3 : idx * 3 + 3]
                a = trns[idx] if trns and idx < len(trns) else 255
                row.append((r, g, b, a))
        rows.append(row)
    return width, height, rows


def write_png(path, rows):
    """写出 8 位 RGBA PNG。"""
    height = len(rows)
    width = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(data)
    return width, height


def alpha_bbox(rows, x0, x1, y0, y1, threshold=ALPHA_THRESHOLD):
    xs, ys = [], []
    for y in range(y0, min(y1, len(rows))):
        for x in range(x0, min(x1, len(rows[y]))):
            if rows[y][x][3] > threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("指定区域内没有可见像素")
    return min(xs), max(xs), min(ys), max(ys)


def crop(rows, x0, y0, x1, y1):
    return [row[x0:x1] for row in rows[y0:y1]]


def scale(rows, out_w, out_h):
    """面积平均（box filter）缩放，保证缩小后不出现锯齿/摩尔纹。"""
    h = len(rows)
    w = len(rows[0])
    out = []
    for oy in range(out_h):
        sy0 = oy * h / out_h
        sy1 = (oy + 1) * h / out_h
        y0, y1 = int(sy0), max(int(sy0) + 1, int(sy1 + 0.999999))
        for ox in range(out_w):
            sx0 = ox * w / out_w
            sx1 = (ox + 1) * w / out_w
            x0, x1 = int(sx0), max(int(sx0) + 1, int(sx1 + 0.999999))
            acc = [0.0, 0.0, 0.0, 0.0]
            n = 0
            for yy in range(y0, y1):
                row = rows[yy]
                for xx in range(x0, x1):
                    px = row[xx]
                    acc[0] += px[0]
                    acc[1] += px[1]
                    acc[2] += px[2]
                    acc[3] += px[3]
                    n += 1
            out.append(tuple(round(v / n) for v in acc))
    return [out[i * out_w : (i + 1) * out_w] for i in range(out_h)]


def build_lockup(rows):
    height, width = len(rows), len(rows[0])
    x0, x1, y0, y1 = alpha_bbox(rows, 0, width, 0, height)
    content_w, content_h = x1 - x0 + 1, y1 - y0 + 1
    pad = round(max(content_w, content_h) * LOCKUP_PADDING)
    cx0, cx1 = max(0, x0 - pad), min(width, x1 + 1 + pad)
    cy0, cy1 = max(0, y0 - pad), min(height, y1 + 1 + pad)
    trimmed = crop(rows, cx0, cy0, cx1, cy1)
    tw, th = len(trimmed[0]), len(trimmed)
    out_h = round(th * LOCKUP_WIDTH / tw)
    return scale(trimmed, LOCKUP_WIDTH, out_h), (content_w, content_h)


def build_symbol(rows):
    height, width = len(rows), len(rows[0])
    # 徽标是 logo 的上一半：以整幅 logo 的垂直中点之前的内容为界
    split = round(height * 0.685)
    x0, x1, y0, y1 = alpha_bbox(rows, 0, width, 0, split)
    content_w, content_h = x1 - x0 + 1, y1 - y0 + 1
    # 先贴身裁出徽标（留一点余量），再放进正方形透明画布，避免裁到文字或压边
    margin = round(max(content_w, content_h) * SYMBOL_MARGIN)
    emblem = crop(
        rows,
        max(0, x0 - margin),
        max(0, y0 - margin),
        min(width, x1 + 1 + margin),
        min(height, y1 + 1 + margin),
    )
    ew, eh = len(emblem[0]), len(emblem)
    side = round(max(ew, eh) / SYMBOL_FILL)
    canvas = [[(0, 0, 0, 0)] * side for _ in range(side)]
    ox, oy = (side - ew) // 2, (side - eh) // 2
    for y in range(eh):
        canvas[oy + y][ox : ox + ew] = emblem[y]
    return scale(canvas, SYMBOL_SIZE, SYMBOL_SIZE), (content_w, content_h)


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        raise SystemExit(f"找不到母版图片：{source}")
    print(f"母版：{source}")
    width, height, rows = read_png(source)
    print(f"  {width}x{height}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    lockup, content = build_lockup(rows)
    out_w, out_h = write_png(OUT_DIR / "xinggui-logo.png", lockup)
    print(f"  完整 logo：{content[0]}x{content[1]} -> {out_w}x{out_h}  public/branding/xinggui-logo.png")

    symbol, content = build_symbol(rows)
    out_w, out_h = write_png(OUT_DIR / "xinggui-symbol.png", symbol)
    print(f"  方形徽标：{content[0]}x{content[1]} -> {out_w}x{out_h}  public/branding/xinggui-symbol.png")


if __name__ == "__main__":
    main()
