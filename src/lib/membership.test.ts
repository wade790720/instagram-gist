import { expect, test } from 'vitest';
import { parse } from './membership';

const GROUP = '998361e5ef944ec4a6937379dd581002';
const page = (pageProps: unknown) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></html>`;
const self = (member?: object) => page({ self: { name: 'someone', member } });

test('members and admins of the community get in', () => {
  expect(parse(self({ role: 'member', groupId: GROUP }))).toBe('member');
  expect(parse(self({ role: 'group-admin', groupId: GROUP }))).toBe('member');
});

test('everyone else is kept out', () => {
  expect(parse(self())).toBe('not-member');
  expect(parse(self({ role: 'member', groupId: 'another-group' }))).toBe('not-member');
  expect(parse(self({ role: 'banned', groupId: GROUP }))).toBe('not-member');
  expect(parse(page({ self: null }))).toBe('signed-out');
});

test('a page we do not understand is an error, not a verdict', () => {
  expect(() => parse('<html>maintenance</html>')).toThrow();
  expect(() => parse(page(undefined))).toThrow();
});
