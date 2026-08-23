import { ApiProperty } from '@nestjs/swagger';

export class PublicUserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'George' })
  firstName!: string;

  @ApiProperty({ example: 'Bluth' })
  lastName!: string;

  @ApiProperty({ example: 'George Bluth' })
  fullName!: string;

  @ApiProperty({
    example: 'ge**********@reqres.in',
    description: 'Obscured address. The real one arrives only via the reveal endpoint.',
  })
  maskedEmail!: string;

  @ApiProperty({ example: 'https://reqres.in/img/faces/1-image.jpg' })
  avatar!: string;
}

export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  perPage!: number;

  @ApiProperty({ example: 4 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

export class UsersPageDto {
  @ApiProperty({ type: [PublicUserDto] })
  data!: PublicUserDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class RevealedEmailDto {
  @ApiProperty({ example: 2 })
  id!: number;

  @ApiProperty({ example: 'janet.weaver@reqres.in' })
  email!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Resource not found' })
  message!: string;

  @ApiProperty({
    example: '9f1c8a4e-0f4a-4a0e-9f1c-8a4e0f4a4a0e',
    description: 'Echoed back so one user action can be traced end to end.',
  })
  correlationId!: string;
}

export class PortalUserDto {
  @ApiProperty({ example: '1234567890', description: 'Google account subject.' })
  id!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ example: 'Ada Lovelace', required: false })
  name?: string;

  @ApiProperty({ example: 'https://lh3.googleusercontent.com/a/...', required: false })
  picture?: string;
}
