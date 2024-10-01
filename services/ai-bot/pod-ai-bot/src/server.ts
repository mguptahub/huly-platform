//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Token, decodeToken } from '@hcengineering/server-token'
import cors from 'cors'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { IncomingHttpHeaders, type Server } from 'http'
import { TranslateRequest, OnboardingEventRequest } from '@hcengineering/ai-bot'

import { ApiError } from './error'
import { AIBotController } from './controller'

const extractCookieToken = (cookie?: string): Token | null => {
  if (cookie === undefined || cookie === null) {
    return null
  }

  const cookies = cookie.split(';')
  const tokenCookie = cookies.find((cookie) => cookie.toLocaleLowerCase().includes('token'))
  if (tokenCookie === undefined) {
    return null
  }

  const encodedToken = tokenCookie.split('=')[1]
  if (encodedToken === undefined) {
    return null
  }

  return decodeToken(encodedToken)
}

const extractAuthorizationToken = (authorization?: string): Token | null => {
  if (authorization === undefined || authorization === null) {
    return null
  }
  const encodedToken = authorization.split(' ')[1]

  if (encodedToken === undefined) {
    return null
  }

  return decodeToken(encodedToken)
}

const extractToken = (headers: IncomingHttpHeaders): Token => {
  try {
    const token = extractCookieToken(headers.cookie) ?? extractAuthorizationToken(headers.authorization)

    if (token === null) {
      throw new ApiError(401)
    }

    return token
  } catch {
    throw new ApiError(401)
  }
}

type AsyncRequestHandler = (req: Request, res: Response, token: Token, next: NextFunction) => Promise<void>

const handleRequest = async (
  fn: AsyncRequestHandler,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req.headers)
    await fn(req, res, token, next)
  } catch (err: unknown) {
    next(err)
  }
}

const wrapRequest = (fn: AsyncRequestHandler) => (req: Request, res: Response, next: NextFunction) => {
  void handleRequest(fn, req, res, next)
}

export function createServer (controller: AIBotController): Express {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.post(
    '/translate',
    wrapRequest(async (req, res) => {
      if (req.body == null || Array.isArray(req.body) || typeof req.body !== 'object') {
        throw new ApiError(400)
      }
      const response = await controller.translate(req.body as TranslateRequest)
      if (response === undefined) {
        throw new ApiError(500)
      }

      res.status(200)
      res.json(response)
    })
  )

  app.post(
    '/onboarding',
    wrapRequest(async (req, res) => {
      if (req.body == null || Array.isArray(req.body) || typeof req.body !== 'object') {
        throw new ApiError(400)
      }

      await controller.processOnboardingEvent(req.body as OnboardingEventRequest)

      res.status(200)
      res.json({})
    })
  )

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.log(err)
    if (err instanceof ApiError) {
      res.status(err.code).send({ code: err.code, message: err.message })
      return
    }

    res.status(500).send(err.message?.length > 0 ? { message: err.message } : err)
  })

  return app
}

export function listen (e: Express, port: number, host?: string): Server {
  const cb = (): void => {
    console.log(`AI service has been started at ${host ?? '*'}:${port}`)
  }

  return host !== undefined ? e.listen(port, host, cb) : e.listen(port, cb)
}