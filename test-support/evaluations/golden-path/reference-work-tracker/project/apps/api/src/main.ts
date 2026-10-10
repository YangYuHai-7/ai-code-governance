import { NestFactory } from '@nestjs/core';
import { createBoardService } from './application/index';
import { createBoardRepository } from './infrastructure/index';
import { createTransport } from './transport/index';

export async function bootstrap(connectionString: string) {
  const store = createBoardRepository(connectionString);
  const service = createBoardService(store);
  await NestFactory.create({ service } as never, { logger: false });
  return createTransport(store, { get() {}, listen() {} } as never);
}
