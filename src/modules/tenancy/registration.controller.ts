import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../identity/auth.decorator.js';
import { RegistrationService, type ApplyDto } from './registration.service.js';

@Controller()
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  apply(@Body() dto: ApplyDto) {
    return this.registrationService.apply(dto);
  }
}
