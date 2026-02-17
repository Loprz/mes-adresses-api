import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  health() {
    return {
      ok: true,
      service: 'mes-adresses-api',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get('health')
  healthAlias() {
    return this.health();
  }

  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        ok: true,
        service: 'mes-adresses-api',
        checks: { postgres: 'ok' },
      };
    } catch {
      throw new ServiceUnavailableException({
        ok: false,
        service: 'mes-adresses-api',
        checks: { postgres: 'error' },
      });
    }
  }
}
