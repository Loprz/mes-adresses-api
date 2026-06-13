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
import {
  CommuneDTO,
  JurisdictionCountyDTO,
  JurisdictionPlaceDTO,
  JurisdictionStateDTO,
} from './dto/commune.dto';

@ApiTags('commune')
@Controller(['commune', 'jurisdictions'])
export class CommuneController {
  constructor(private communeService: CommuneService) {}

  @Get('states')
  @ApiOperation({
    summary: 'List states for the jurisdiction selector',
    operationId: 'listStates',
  })
  @ApiResponse({ status: 200, type: JurisdictionStateDTO, isArray: true })
  async listStates(@Res() res: Response) {
    res.status(HttpStatus.OK).json(this.communeService.listStates());
  }

  @Get('states/:stateFips/counties')
  @ApiOperation({
    summary: 'List counties in a state for the jurisdiction selector',
    operationId: 'listCounties',
  })
  @ApiParam({ name: 'stateFips', required: true, type: String })
  @ApiResponse({ status: 200, type: JurisdictionCountyDTO, isArray: true })
  async listCounties(@Req() req: Request, @Res() res: Response) {
    const { stateFips } = req.params;
    res.status(HttpStatus.OK).json(this.communeService.listCounties(stateFips));
  }

  @Get('counties/:countyFips/places')
  @ApiOperation({
    summary: 'List places in a county for the jurisdiction selector',
    operationId: 'listPlaces',
  })
  @ApiParam({ name: 'countyFips', required: true, type: String })
  @ApiResponse({ status: 200, type: JurisdictionPlaceDTO, isArray: true })
  async listPlaces(@Req() req: Request, @Res() res: Response) {
    const { countyFips } = req.params;
    res.status(HttpStatus.OK).json(this.communeService.listPlaces(countyFips));
  }

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
