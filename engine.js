/* jawiki 文字種パターン検索エンジン（JS版）
 * Python 版 jawiki_pattern_search.py の移植。ブラウザ / Node 両対応。
 * 署名（文字種の並び）の規則と索引フォーマットは Python 版と一致させてある。
 */
(function (global) {
  'use strict';

  // 型を表す記号（Python 版と同一）
  const HIRAGANA = 'あ', KATAKANA = 'ア', KANJI = '漢',
        DIGIT = '1', UPPER = 'A', LOWER = 'a', SPACE = '␣', SYMBOL = '@';
  const TYPE_ALPHABET = new Set(
    [HIRAGANA, KATAKANA, KANJI, DIGIT, UPPER, LOWER, SPACE, SYMBOL]);

  // 除外（結合 Mn/Me・書式 Cf・制御 Cc）と空白（Zs）の判定
  const EXCL = /[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u;
  const ZS = /\p{Zs}/u;

  function classifyChar(ch, fullwidth) {
    if (fullwidth === undefined) fullwidth = true;
    if (EXCL.test(ch)) return null;
    if (ZS.test(ch)) return SPACE;
    const code = ch.codePointAt(0);

    if (code >= 0x30 && code <= 0x39) return DIGIT;
    if (code >= 0x41 && code <= 0x5A) return UPPER;
    if (code >= 0x61 && code <= 0x7A) return LOWER;

    if (fullwidth) {
      if (code >= 0xFF10 && code <= 0xFF19) return DIGIT;
      if (code >= 0xFF21 && code <= 0xFF3A) return UPPER;
      if (code >= 0xFF41 && code <= 0xFF5A) return LOWER;
    }

    if ((code >= 0x3041 && code <= 0x3096) ||
        (code >= 0x309D && code <= 0x309F)) return HIRAGANA;

    if ((code >= 0x30A1 && code <= 0x30FA) ||
        (code >= 0x30FC && code <= 0x30FF) ||
        (code >= 0x31F0 && code <= 0x31FF) ||
        (code >= 0xFF66 && code <= 0xFF9D)) return KATAKANA;

    if ((code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0x20000 && code <= 0x2A6DF) ||
        (code >= 0x2A700 && code <= 0x2EBEF) ||
        (code >= 0x2F800 && code <= 0x2FA1F) ||
        code === 0x3005 || code === 0x3006 || code === 0x3007) return KANJI;

    return SYMBOL;
  }

  function signature(str, fullwidth) {
    let out = '';
    for (const ch of str) {           // コードポイント単位で反復
      const t = classifyChar(ch, fullwidth);
      if (t !== null) out += t;
    }
    return out;
  }

  // 混在パターン [漢]＝型、その他＝リテラル文字 をトークン列へ
  function parseMixed(pattern) {
    const tokens = [];
    const chars = Array.from(pattern); // コードポイント配列
    let i = 0;
    const n = chars.length;
    while (i < n) {
      if (chars[i] === '[' && i + 2 < n &&
          TYPE_ALPHABET.has(chars[i + 1]) && chars[i + 2] === ']') {
        tokens.push({ kind: 'type', val: chars[i + 1] });
        i += 3;
      } else {
        tokens.push({ kind: 'lit', val: chars[i] });
        i += 1;
      }
    }
    return tokens;
  }

  function mixedSignature(tokens, fullwidth) {
    let sig = '';
    for (const t of tokens) {
      if (t.kind === 'type') {
        sig += t.val;
      } else {
        const c = classifyChar(t.val, fullwidth);
        if (c === null) return null;
        sig += c;
      }
    }
    return sig;
  }

  function titleElements(title, fullwidth) {
    const out = [];
    for (const ch of title) {
      const t = classifyChar(ch, fullwidth);
      if (t !== null) out.push([ch, t]);
    }
    return out;
  }

  function mixedMatch(tokens, title, fullwidth) {
    const els = titleElements(title, fullwidth);
    if (els.length !== tokens.length) return false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i], el = els[i];
      if (tok.kind === 'type') {
        if (el[1] !== tok.val) return false;
      } else if (el[0] !== tok.val) {
        return false;
      }
    }
    return true;
  }

  // data = { fullwidth: bool, index: {署名: 'タイトル\nタイトル...'} }
  // 完全一致（型＋リテラル）。limit=0 で無制限。emit(title) があれば逐次通知。
  function searchMixed(data, pattern, fullwidth, limit, emit) {
    const tokens = parseMixed(pattern);
    const index = data.index;
    const results = [];
    const push = (t) => {
      results.push(t);
      if (emit) emit(t);
      return !(limit && results.length >= limit);
    };
    const hasLiteral = tokens.some((t) => t.kind === 'lit');

    if (data.fullwidth === fullwidth) {
      const sig = mixedSignature(tokens, fullwidth);
      if (sig !== null) {
        const joined = index[sig];
        if (joined) {
          const titles = joined.split('\n');
          if (!hasLiteral) {                 // 純粋に型のみ → バケツ全件
            for (const t of titles) if (!push(t)) break;
          } else {
            for (const t of titles) {
              if (mixedMatch(tokens, t, fullwidth) && !push(t)) break;
            }
          }
        }
        return results;
      }
    }
    // フォールバック（全角設定が索引と異なる等）→ 全件総なめ
    outer:
    for (const sig in index) {
      for (const t of index[sig].split('\n')) {
        if (mixedMatch(tokens, t, fullwidth)) {
          if (!push(t)) break outer;
        }
      }
    }
    return results;
  }

  // 正規表現（署名に対するマッチ）。ci=大文字小文字を区別しない
  function searchRegex(data, pattern, fullwidth, limit, ci, emit) {
    const rx = new RegExp('^(?:' + pattern + ')$', ci ? 'iu' : 'u');
    const index = data.index;
    const results = [];
    const push = (t) => {
      results.push(t);
      if (emit) emit(t);
      return !(limit && results.length >= limit);
    };
    if (data.fullwidth === fullwidth) {
      for (const sig in index) {
        if (rx.test(sig)) {
          for (const t of index[sig].split('\n')) if (!push(t)) return results;
        }
      }
    } else {
      outer:
      for (const sig in index) {
        for (const t of index[sig].split('\n')) {
          if (rx.test(signature(t, fullwidth))) {
            if (!push(t)) break outer;
          }
        }
      }
    }
    return results;
  }

  // 型記号 → 実タイトル用の正規表現文字クラス（u フラグ前提）
  function titleClass(sym, fw) {
    switch (sym) {
      case HIRAGANA: return '[\\u3041-\\u3096\\u309D-\\u309F]';
      case KATAKANA: return '[\\u30A1-\\u30FA\\u30FC-\\u30FF\\u31F0-\\u31FF\\uFF66-\\uFF9D]';
      case KANJI:    return '[\\u3005-\\u3007\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF'
                          + '\\u{20000}-\\u{2A6DF}\\u{2A700}-\\u{2EBEF}\\u{2F800}-\\u{2FA1F}]';
      case DIGIT:    return fw ? '[0-9\\uFF10-\\uFF19]' : '[0-9]';
      case UPPER:    return fw ? '[A-Z\\uFF21-\\uFF3A]' : '[A-Z]';
      case LOWER:    return fw ? '[a-z\\uFF41-\\uFF5A]' : '[a-z]';
      case SPACE:    return '[\\p{Zs}]';
      case SYMBOL:   return '.';   // 近似（任意の1文字）
      default:       return null;
    }
  }

  // [漢] 等の単一型記号ブラケットを文字クラスに置換。他はそのまま（正規表現）
  function toTitleRegexSource(pattern, fw) {
    return pattern.replace(/\[(.)\]/gu, (m, ch) => titleClass(ch, fw) || m);
  }

  // 正規表現を「実タイトル」に対してマッチ（チップ＝型ワイルドカード、リテラル可）
  function searchRegexTitle(data, pattern, fullwidth, limit, ci, emit) {
    const rx = new RegExp('^(?:' + toTitleRegexSource(pattern, fullwidth) + ')$',
                          ci ? 'iu' : 'u');
    return scanTitles(data, rx, limit, emit);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 完全一致を「実タイトル」に対してマッチ（大小無視トグル用）。
  // 型チップ→文字クラス、リテラル→エスケープして厳密一致。
  function searchMixedTitle(data, pattern, fullwidth, limit, ci, emit) {
    let src = '';
    for (const t of parseMixed(pattern)) {
      src += (t.kind === 'type')
        ? (titleClass(t.val, fullwidth) || escapeRegExp(t.val))
        : escapeRegExp(t.val);
    }
    const rx = new RegExp('^(?:' + src + ')$', ci ? 'iu' : 'u');
    return scanTitles(data, rx, limit, emit);
  }

  // 全タイトルを走査して正規表現に一致するものを集める
  function scanTitles(data, rx, limit, emit) {
    const index = data.index;
    const results = [];
    for (const sig in index) {
      for (const title of index[sig].split('\n')) {
        if (rx.test(title)) {
          results.push(title);
          if (emit) emit(title);
          if (limit && results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  const api = {
    HIRAGANA, KATAKANA, KANJI, DIGIT, UPPER, LOWER, SPACE, SYMBOL,
    TYPE_ALPHABET, classifyChar, signature, parseMixed, mixedSignature,
    mixedMatch, searchMixed, searchRegex, searchRegexTitle, searchMixedTitle,
    toTitleRegexSource,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.JawikiEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
