import consola from "consola"

import { getOauthAppConfig, getOauthUrls } from "~/lib/api-config"
import { sleep } from "~/lib/utils"

import type { DeviceCodeResponse } from "./get-device-code"

export async function pollAccessToken(
  deviceCode: DeviceCodeResponse,
): Promise<string> {
  const { clientId, headers } = getOauthAppConfig()
  const { accessTokenUrl } = getOauthUrls()

  // Interval is in seconds, we need to multiply by 1000 to get milliseconds
  // I'm also adding another second, just to be safe
  const sleepDuration = (deviceCode.interval + 1) * 1000
  consola.debug(`Polling access token with interval of ${sleepDuration}ms`)

  while (true) {
    const response = await fetch(accessTokenUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    if (!response.ok) {
      await sleep(sleepDuration)
      consola.error("Failed to poll access token:", await response.text())

      continue
    }

    const json: unknown = await response.json()
    consola.debug("Polling access token response received")

    if (
      typeof json === "object"
      && json !== null
      && "access_token" in json
      && typeof json.access_token === "string"
      && json.access_token
    ) {
      return json.access_token
    }

    await sleep(sleepDuration)
  }
}
