import { describe, expect, it } from 'vitest'
import {
  continuationFromHtml,
  parseInnertubeChat,
  parseIrc,
  parseOfficialChat,
  parseYoutubeTarget,
  reconnectDelay,
  shouldLink,
  twitchItem
} from '../src/shared/live'

describe('live chat parsing', () => {
  it('reads a Twitch message, bits, and a raid', () => {
    const chat = twitchItem(
      '@badge-info=;badges=moderator/1;color=#FF0000;display-name=NiceMod;mod=1 :nicemod!nicemod@nicemod.tmi.twitch.tv PRIVMSG #demo :hello chat',
      5,
      () => 0.2,
      true
    )
    expect(chat?.message.username).toBe('NiceMod')
    expect(chat?.message.badge).toBe('mod')
    expect(chat?.message.text).toBe('hello chat')
    expect(chat?.alert).toBe(false)
    const bits = twitchItem(
      '@badges=;bits=100;display-name=CoinFan :coinfan!coinfan@coinfan.tmi.twitch.tv PRIVMSG #demo :cheers',
      6,
      () => 0.3,
      true
    )
    expect(bits?.message.kind).toBe('bits')
    expect(bits?.message.amount).toBe('100 bits')
    expect(bits?.alert).toBe(true)
    const raid = twitchItem(
      '@msg-id=raid;display-name=RaidBoss;msg-param-viewerCount=42;msg-param-displayName=RaidBoss :tmi.twitch.tv USERNOTICE #demo :',
      7,
      () => 0.4,
      true
    )
    expect(raid?.message.kind).toBe('raid')
    expect(raid?.message.viewers).toBe(42)
    const hidden = twitchItem(
      '@display-name=Salty :salty!salty@salty.tmi.twitch.tv PRIVMSG #demo :what the fuck',
      8,
      () => 0.5,
      true
    )
    expect(hidden?.message.text).toBe('what the ****')
    expect(parseIrc('PING :tmi.twitch.tv')).toBeNull()
  })

  it('parses YouTube targets, innertube chat, and the official payload', () => {
    expect(parseYoutubeTarget('https://youtu.be/dQw4w9WgXcQ').type).toBe('video')
    expect(parseYoutubeTarget('@SomeHandle')).toEqual({ type: 'handle', handle: 'SomeHandle' })
    expect(parseYoutubeTarget('not a url')).toEqual({ type: 'invalid' })
    const html = '{"reloadContinuationData":{"continuation":"TOKEN123"}}'
    expect(continuationFromHtml(html)).toBe('TOKEN123')
    const page = parseInnertubeChat(
      {
        continuationContents: {
          liveChatContinuation: {
            actions: [
              {
                addChatItemAction: {
                  item: {
                    liveChatPaidMessageRenderer: {
                      authorName: { simpleText: 'SuperFan' },
                      message: { runs: [{ text: 'have a snack' }] },
                      purchaseAmountText: { simpleText: '$5.00' }
                    }
                  }
                }
              }
            ],
            continuations: [{ timedContinuationData: { continuation: 'NEXT', timeoutMs: 2000 } }]
          }
        }
      },
      9,
      () => 0.2,
      true
    )
    expect(page.items[0]?.message.kind).toBe('donation')
    expect(page.items[0]?.message.amount).toBe('$5.00')
    expect(page.continuation).toBe('NEXT')
    const official = parseOfficialChat(
      {
        pollingIntervalMillis: 3000,
        nextPageToken: 'PAGE',
        items: [
          {
            snippet: { type: 'textMessageEvent', displayMessage: 'hello from youtube' },
            authorDetails: { displayName: 'YtFan' }
          }
        ]
      },
      10,
      () => 0.2,
      true
    )
    expect(official.items[0]?.message.text).toBe('hello from youtube')
    expect(official.continuation).toBe('PAGE')
    expect(reconnectDelay(0)).toBeLessThan(reconnectDelay(4))
    expect(shouldLink({ offline: true, liveLink: true, target: 'demo' })).toBe(false)
    expect(shouldLink({ offline: false, liveLink: true, target: 'demo' })).toBe(true)
  })
})
