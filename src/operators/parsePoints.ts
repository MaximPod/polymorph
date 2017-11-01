import { _, Z, T, Q, S, C, V, H, EMPTY } from '../constants'
import { coalesce } from '../utilities/coalesce'
import { IParseContext, FloatArray } from '../types'
import { raiseError } from '../utilities/errors'
import { quadraticRatio } from '../utilities/math'

// describes the number of arguments each command has
const argLengths = { M: 2, H: 1, V: 1, L: 2, Z: 0, C: 6, S: 4, Q: 4, T: 2 }

function m(ctx: IParseContext): void {
    const n = ctx.t
    addSegment(ctx, n[0], n[1])
}
function h(ctx: IParseContext): void {
    addCurve(ctx, _, _, _, _, ctx.t[0], _)
}
function v(ctx: IParseContext): void {
    addCurve(ctx, _, _, _, _, _, ctx.t[0])
}
function l(ctx: IParseContext): void {
    const n = ctx.t
    addCurve(ctx, _, _, _, _, n[0], n[1])
}
function z(ctx: IParseContext): void {
    addCurve(ctx, _, _, _, _, ctx.p[0], ctx.p[1])
}
function c(ctx: IParseContext): void {
    const n = ctx.t
    addCurve(ctx, n[0], n[1], n[2], n[3], n[4], n[5])

    // set last control point for subsequence C/S
    ctx.cx = n[2]
    ctx.cy = n[3]
}
function s(ctx: IParseContext): void {
    const n = ctx.t
    const isInitialCurve = ctx.lc !== S && ctx.lc !== C
    const x1 = isInitialCurve ? _ : ctx.x * 2 - ctx.cx
    const y1 = isInitialCurve ? _ : ctx.y * 2 - ctx.cy

    addCurve(ctx, x1, y1, n[0], n[1], n[2], n[3])

    // set last control point for subsequence C/S
    ctx.cx = n[0]
    ctx.cy = n[1]
}
function q(ctx: IParseContext): void {
    const n = ctx.t
    const cx1 = n[0]
    const cy1 = n[1]
    const dx = n[2]
    const dy = n[3]
    const x = ctx.x
    const y = ctx.y

    addCurve(
        ctx,
        x + (cx1 - x) * quadraticRatio,
        y + (cy1 - y) * quadraticRatio,
        dx + (cx1 - dx) * quadraticRatio,
        dy + (cy1 - dy) * quadraticRatio,
        dx,
        dy
    )

    ctx.cx = cx1
    ctx.cy = cy1
}
function t(ctx: IParseContext): void {
    const n = ctx.t
    const dx = n[0]
    const dy = n[1]
    const x = ctx.x
    const y = ctx.y

    let x1: number, y1: number, x2: number, y2: number
    if (ctx.lc === Q || ctx.lc === T) {
        const cx1 = x * 2 - ctx.cx
        const cy1 = y * 2 - ctx.cy
        x1 = x + (cx1 - x) * quadraticRatio
        y1 = y + (cy1 - y) * quadraticRatio
        x2 = dx + (cx1 - dx) * quadraticRatio
        y2 = dy + (cy1 - dy) * quadraticRatio
    } else {
        x1 = x2 = x
        y1 = y2 = y
    }

    addCurve(ctx, x1, y1, x2, y2, dx, dy)

    ctx.cx = x2
    ctx.cy = y2
}

const parsers = {
    M: m,
    H: h,
    V: v,
    L: l,
    Z: z,
    C: c,
    S: s,
    Q: q,
    T: t
}

/**
 * Creates a new segment on this path
 * @param ctx Parser context
 * @param x Starting x position on this segment
 * @param y Starting y position on this segment
 */
function addSegment(ctx: IParseContext, x: number, y: number): void {
    ctx.x = x
    ctx.y = y

    const p = [x, y]
    ctx.s.push(p)
    ctx.p = p
}

/**
 * Adds a curve to the segment
 * @param ctx Parser context
 * @param x1 start control point x
 * @param y1 start control point y
 * @param x2 end control point x
 * @param y2 end control point y
 * @param dx destination x
 * @param dy destination y
 */
function addCurve(
    ctx: IParseContext,
    x1: number | undefined,
    y1: number | undefined,
    x2: number | undefined,
    y2: number | undefined,
    dx: number | undefined,
    dy: number | undefined
): void {
    // store x and y
    const x = ctx.x
    const y = ctx.y

    // move cursor
    ctx.x = coalesce(dx, x)
    ctx.y = coalesce(dy, y)

    // add numbers to points
    ctx.p.push(coalesce(x1, x), (y1 = coalesce(y1, y)), (x2 = coalesce(x2, x)), (y2 = coalesce(y2, y)), ctx.x, ctx.y)

    // set last command type
    ctx.lc = ctx.c
}

/**
 * Converts the current terms in the context to absolute position based on the
 * current cursor position
 * @param ctx Parser context
 */
function convertToAbsolute(ctx: IParseContext): void {
    if (ctx.c === V) {
        ctx.t[0] += ctx.y
    } else if (ctx.c === H) {
        ctx.t[0] += ctx.x
    } else {
        for (let j = 0; j < ctx.t.length; j += 2) {
            ctx.t[j] += ctx.x
            ctx.t[j + 1] += ctx.y
        }
    }
}

function parseSegments(d: string): (string | number)[][] {
    // replace all terms with space + term to remove garbage
    // replace command letters with an additional space
    // remove spaces around
    // split on double-space (splits on command segment)
    // parse each segment into an of list of command + args
    return d
        .replace(/[\^\s]*([mhvlzcsqta]|\-?[0-9]*\.?[0-9]+)[,\$\s]*/gi, ' $1')
        .replace(/([mhvlzcsqta])/gi, ' $1')
        .trim()
        .split('  ')
        .map(parseSegment)
}

function parseSegment(s2: string): (string | number)[] {
    // split command segment into command + args
    return s2.split(EMPTY).map(parseCommand)
}

function parseCommand(str: string, i: number): string | number {
    // convert all terms except command into a number
    return i === 0 ? str : +str
}

/**
 * Returns an [] with cursor position + polybezier [mx, my, ...[x1, y1, x2, y2, dx, dy] ]
 * @param d string to parse
 */
export function parsePoints(d: string): FloatArray[] {
    // create parser context
    const ctx: IParseContext = {
        x: 0,
        y: 0,
        s: []
    }

    // split into segments
    const segments = parseSegments(d)

    // start building
    for (let i = 0; i < segments.length; i++) {
        const terms = segments[i]
        const commandLetter = terms[0] as string

        // setup context
        const command = commandLetter.toUpperCase()
        const isRelative = command !== Z && command !== commandLetter

        // set command on context
        ctx.c = command

        // find command parser
        const parser = parsers[command]
        const maxLength = argLengths[command]
        if (!parser) {
            console.log(ctx)
            raiseError(ctx.c, ' is not supported')
        }

        // process each part of this command.  Use do-while to accomodate Z
        const t2 = terms as number[]
        let k = 1
        do {
            // split this segment into a sub-segment
            ctx.t = t2.length === 1 ? t2 : t2.slice(k, k + maxLength)

            // convert to absolute if necessary
            if (isRelative) {
                convertToAbsolute(ctx)
            }
            // parse
            parser(ctx)
            k += maxLength
        } while (k < t2.length)
    }

    // return segments with the largest sub-paths first
    // this makes it more likely that holes will be filled
    return ctx.s
}