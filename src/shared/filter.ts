const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i'
}

const BLOCKED_WORDS = [
  'nigger',
  'niggers',
  'nigga',
  'niggas',
  'niggah',
  'nigguh',
  'faggot',
  'faggots',
  'fag',
  'fags',
  'retard',
  'retards',
  'retarded',
  'tranny',
  'trannies',
  'kike',
  'kikes',
  'spic',
  'spics',
  'chink',
  'chinks',
  'wetback',
  'wetbacks',
  'beaner',
  'beaners',
  'coon',
  'coons',
  'gook',
  'gooks',
  'porn',
  'porno',
  'pornography',
  'hentai',
  'nsfw',
  'nude',
  'nudes',
  'horny',
  'penis',
  'vagina',
  'boob',
  'boobs',
  'tit',
  'tits',
  'titties',
  'dick',
  'dicks',
  'cock',
  'cocks',
  'pussy',
  'dildo',
  'blowjob',
  'handjob',
  'cum',
  'cumshot',
  'orgasm',
  'fetish',
  'onlyfans',
  'gyatt',
  'thicc',
  'slut',
  'sluts',
  'whore',
  'whores',
  'sex',
  'sexy',
  'anal',
  'fuck',
  'fucks',
  'fucking',
  'fucked',
  'fucker',
  'fuckers',
  'motherfucker',
  'shit',
  'shits',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'asshole',
  'assholes',
  'kys',
  'dox',
  'doxx',
  'doxxed',
  'doxxing'
]

const PHRASES = [
  /\bkill\s+yourself\b/,
  /\bkill\s+your\s*self\b/,
  /\bkill\s+urself\b/,
  /\bunalive\s+yourself\b/,
  /\bhawk\s+tuah\b/,
  /\bonly\s+fans\b/,
  /\bswat\s+them\b/,
  /\bhome\s+address\b/
]

function squeezeWord(word: string): string {
  return word.replace(/([a-z])\1+/g, '$1')
}

export function normalizeForFilter(input: string): { spaced: string; squeezed: string } {
  let spaced = input.replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase()
  spaced = spaced.replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch)
  spaced = spaced.replace(/[^a-z\s]/g, ' ')
  spaced = spaced.replace(/\s+/g, ' ').trim()
  spaced = spaced.replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ''))
  const squeezed = spaced.split(' ').map(squeezeWord).join(' ')
  return { spaced, squeezed }
}

function hasWord(spaced: string, squeezed: string, term: string): boolean {
  const direct = new RegExp(`\\b${term}\\b`, 'i')
  if (direct.test(spaced)) return true
  const squeezedTerm = squeezeWord(term)
  return new RegExp(`\\b${squeezedTerm}\\b`, 'i').test(squeezed)
}

export function isKidSafe(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (trimmed.length > 220) return false
  if (/https?:\/\/|discord\.gg|www\./i.test(trimmed)) return false
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(trimmed)) return false
  const { spaced, squeezed } = normalizeForFilter(trimmed)
  if (!spaced) return true
  for (const phrase of PHRASES) {
    if (phrase.test(spaced) || phrase.test(squeezed)) return false
  }
  for (const word of BLOCKED_WORDS) {
    if (hasWord(spaced, squeezed, word)) return false
  }
  return true
}
