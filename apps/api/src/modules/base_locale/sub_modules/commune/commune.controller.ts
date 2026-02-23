import { Controller, Res, Req, HttpStatus, Get, Query } from '@nestjs/common';
import { Response, Request } from 'express';
import {
  ApiParam,
  ApiTags,
  ApiResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

import { CommuneService } from './commune.service';
import { CommuneDTO } from './dto/commune.dto';

@ApiTags('commune')
@Controller(['commune', 'jurisdictions'])
export class CommuneController {
  constructor(private communeService: CommuneService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search jurisdictions (cities, towns, and counties) by name',
    description:
      'Search US jurisdictions by name, state abbreviation, or FIPS code. ' +
      'Returns both city/town-level places (7-digit FIPS) and counties (5-digit FIPS). ' +
      'Cities and towns are ranked higher as they are the more common addressing authority. ' +
      'Examples: "Los Angeles", "Ashland OR", "Cook IL", "0644000", "06037", "CA"',
    operationId: 'searchCommunes',
  })
  @ApiQuery({ name: 'nom', required: true, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async searchCommunes(
    @Query('nom') nom: string,
    @Query('limit') limit: string,
    @Res() res: Response,
  ) {
    const results = this.communeService.searchCommunes(
      nom,
      limit ? parseInt(limit, 10) : 20,
    );
    res.status(HttpStatus.OK).json(results);
  }

  @Get(':codeCommune')
  @ApiOperation({
    summary: 'Find info commune',
    operationId: 'findCommune',
  })
  @ApiParam({ name: 'codeCommune', required: true, type: String })
  @ApiResponse({ status: 200, type: CommuneDTO })
  async getCommuneExtraData(@Req() req: Request, @Res() res: Response) {
    const { codeCommune } = req.params;
    const communeExtraData =
      this.communeService.getCommuneExtraData(codeCommune);
    res.status(HttpStatus.OK).json(communeExtraData);
  }
}
