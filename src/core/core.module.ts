import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';

import { CoreApiClient } from './core-api.client';

@Global()
@Module({
  imports: [HttpModule],
  providers: [CoreApiClient],
  exports: [CoreApiClient],
})
export class CoreModule {}
