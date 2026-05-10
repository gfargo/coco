import { openProviderUrl } from './providerActions'

describe('log provider actions', () => {
  const repository = {
    provider: 'github' as const,
    remote: 'origin',
    owner: 'gfargo',
    name: 'coco',
    webUrl: 'https://github.com/gfargo/coco',
  }

  it('opens supported provider URLs', async () => {
    const openUrl = jest.fn().mockResolvedValue(undefined)

    await expect(openProviderUrl(repository, { type: 'commit', commit: 'abc123' }, openUrl)).resolves.toEqual({
      ok: true,
      message: 'Opened provider URL: https://github.com/gfargo/coco/commit/abc123',
      details: ['https://github.com/gfargo/coco/commit/abc123'],
    })
    expect(openUrl).toHaveBeenCalledWith('https://github.com/gfargo/coco/commit/abc123')
  })

  it('reports unsupported provider URLs clearly', async () => {
    const openUrl = jest.fn()

    await expect(openProviderUrl({
      provider: 'unsupported',
      remote: 'origin',
    }, { type: 'repo' }, openUrl)).resolves.toEqual({
      ok: false,
      message: 'No supported remote provider URL is available.',
    })
    expect(openUrl).not.toHaveBeenCalled()
  })
})

