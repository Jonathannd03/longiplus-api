import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../identity/auth.decorator.js';
import { RegistrationService, ApplyDto } from './registration.service.js';

@Controller()
export class RegistrationController {
  constructor(@Inject(RegistrationService) private readonly registrationService: RegistrationService) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  apply(@Body() dto: ApplyDto) {
    return this.registrationService.apply(dto);
  }
}
